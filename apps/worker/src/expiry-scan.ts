/**
 * The nightly expiry scan (P1A-07, SOW §6 and §16).
 *
 * One job for every expiring document, whatever it is attached to: Emirates ID, driving
 * licence, passport, visa, trade licence, mulkiya and — from milestone 1D — insurance
 * policies. That is the whole reason `Document` carries a polymorphic owner.
 *
 * The rules are in `@drivenx/core` and are pure. This file is the I/O around them: read
 * the documents, decide what to raise, write the notifications. `now` is a parameter, so
 * the job is testable at exact boundaries rather than "whenever the suite happens to run".
 */

import {
  businessDate,
  dueReminderOffsets,
  expiredDedupeKey,
  expiryStatus,
  reminderDedupeKey,
} from "@drivenx/core";
import { prisma, type DocumentStatus } from "@drivenx/db";
import { logger } from "@drivenx/logger";

/**
 * How far ahead to look.
 *
 * Comfortably beyond any plausible reminder offset — the widest seeded one is 90 days for
 * a passport — while keeping the query bounded as the document table grows. Documents
 * already past their expiry are not bounded: one that lapsed while the system was down
 * still needs its alert raised.
 */
const SCAN_HORIZON_DAYS = 400;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ExpiryScanResult {
  documentsScanned: number;
  statusesUpdated: number;
  notificationsCreated: number;
}

interface PendingNotification {
  type: "DOCUMENT_EXPIRY";
  severity: "WARNING" | "CRITICAL";
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  dueOn: Date;
  dedupeKey: string;
}

/**
 * Who the document belongs to, for a notification that names it.
 *
 * "An Emirates ID expires in 7 days" is not actionable. Whose it is, is the entire
 * content of the message.
 */
async function ownerLabels(
  documents: { ownerType: string; ownerId: string }[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const idsFor = (type: string) =>
    [...new Set(documents.filter((d) => d.ownerType === type).map((d) => d.ownerId))];

  const customerIds = idsFor("CUSTOMER");
  const supplierIds = idsFor("SUPPLIER");

  const [customers, suppliers] = await Promise.all([
    customerIds.length
      ? prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, code: true, fullName: true },
        })
      : [],
    supplierIds.length
      ? prisma.supplier.findMany({
          where: { id: { in: supplierIds } },
          select: { id: true, code: true, companyName: true },
        })
      : [],
  ]);

  for (const customer of customers) {
    labels.set(`CUSTOMER:${customer.id}`, `${customer.fullName} (${customer.code})`);
  }
  for (const supplier of suppliers) {
    labels.set(`SUPPLIER:${supplier.id}`, `${supplier.companyName} (${supplier.code})`);
  }

  return labels;
}

export async function runExpiryScan(now: Date = new Date()): Promise<ExpiryScanResult> {
  const horizon = new Date(now.getTime() + SCAN_HORIZON_DAYS * DAY_MS);

  const documents = await prisma.document.findMany({
    where: {
      deletedAt: null,
      status: { not: "REPLACED" },
      expiryDate: { not: null, lte: horizon },
    },
    select: {
      id: true,
      ownerType: true,
      ownerId: true,
      expiryDate: true,
      reminderOffsets: true,
      status: true,
      category: { select: { label: true } },
    },
  });

  const labels = await ownerLabels(documents);
  const notifications: PendingNotification[] = [];
  const statusChanges = new Map<DocumentStatus, string[]>();

  for (const document of documents) {
    // Narrowed by the query above; the column is nullable in general.
    const expiryDate = document.expiryDate;
    if (!expiryDate) continue;

    const status = expiryStatus(expiryDate, document.reminderOffsets, now);
    const stored: DocumentStatus =
      status === "expired" ? "EXPIRED" : status === "expiring" ? "EXPIRING" : "VALID";

    if (stored !== document.status) {
      const group = statusChanges.get(stored) ?? [];
      group.push(document.id);
      statusChanges.set(stored, group);
    }

    const owner = labels.get(`${document.ownerType}:${document.ownerId}`) ?? document.ownerId;
    const what = document.category.label;

    if (status === "expired") {
      notifications.push({
        type: "DOCUMENT_EXPIRY",
        severity: "CRITICAL",
        title: `${what} has expired`,
        body: `${what} for ${owner} expired on ${businessDate(expiryDate)}.`,
        entityType: "Document",
        entityId: document.id,
        dueOn: expiryDate,
        dedupeKey: expiredDedupeKey(document.id, expiryDate),
      });
      continue;
    }

    /**
     * One notification per document per run — the narrowest offset crossed.
     *
     * The engine reports every offset already passed, which is what a caller needs to
     * know. Turning all of them into notifications would mean a document uploaded when
     * it is already 29 days from expiry announces both its 60-day and its 30-day
     * warning at once. The tightest one is the true and useful statement; the wider
     * ones are stale the moment they are crossed. This is also what the milestone's
     * exit criterion asks for: 29 days produces exactly one notification.
     */
    const crossed = dueReminderOffsets(expiryDate, document.reminderOffsets, now);
    const narrowest = crossed.at(-1);
    if (narrowest === undefined) continue;

    notifications.push({
      type: "DOCUMENT_EXPIRY",
      severity: "WARNING",
      title: `${what} expires soon`,
      body: `${what} for ${owner} expires on ${businessDate(expiryDate)}.`,
      entityType: "Document",
      entityId: document.id,
      dueOn: expiryDate,
      dedupeKey: reminderDedupeKey(document.id, narrowest),
    });
  }

  await Promise.all(
    [...statusChanges].map(([status, ids]) =>
      prisma.document.updateMany({ where: { id: { in: ids } }, data: { status } }),
    ),
  );

  // `skipDuplicates` against the unique dedupeKey is what makes a second run in the same
  // day a no-op. Without it the same expiry is announced every night until nobody reads
  // the notifications at all.
  const created = notifications.length
    ? await prisma.notification.createMany({ data: notifications, skipDuplicates: true })
    : { count: 0 };

  const statusesUpdated = [...statusChanges.values()].reduce((sum, ids) => sum + ids.length, 0);

  return {
    documentsScanned: documents.length,
    statusesUpdated,
    notificationsCreated: created.count,
  };
}

export async function runExpiryScanLogged(now: Date = new Date()): Promise<ExpiryScanResult> {
  const startedAt = Date.now();
  const result = await runExpiryScan(now);

  logger.info("expiry scan complete", {
    ...result,
    durationMs: Date.now() - startedAt,
  });

  return result;
}
