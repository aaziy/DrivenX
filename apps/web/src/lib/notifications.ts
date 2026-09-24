/**
 * Who sees which notification, and what it says.
 *
 * A notification with a null `userId` is addressed to "everyone who holds the relevant
 * permission" (see the schema). That rule now lives in `@drivenx/auth`, because delivery
 * (P3-01) needs the same answer: the people to email about a notification are exactly the
 * people entitled to see it.
 */

import { visibleNotificationTypes, type Principal } from "@drivenx/auth";
import { prisma, type NotificationType } from "@drivenx/db";

/**
 * Re-exported rather than defined here: delivery needs the same rule, so it lives in
 * `@drivenx/auth` where both this app and the worker can reach it.
 */
export function visibleTypes(principal: Principal): NotificationType[] {
  return visibleNotificationTypes(principal);
}

/** The `where` clause for everything this person is entitled to see. */
export function visibilityWhere(principal: Principal) {
  return {
    type: { in: visibleTypes(principal) },
    // Addressed to everyone, or addressed to them specifically.
    OR: [{ userId: null }, { userId: principal.id }],
  };
}

export async function unreadCount(principal: Principal): Promise<number> {
  if (visibleTypes(principal).length === 0) return 0;

  return prisma.notification.count({
    where: { ...visibilityWhere(principal), readAt: null },
  });
}

export interface ResolvedEntity {
  /** Where clicking the notification should land. */
  href: string;
  /** The category's stored label — used as written once the client has reworded it. */
  what: string;
  /** Enough to translate a seeded label instead; see i18n/labels.ts. */
  categoryKey: string;
  categoryIsSystem: boolean;
  /** Whose it is, with their code. */
  who: string;
}

/**
 * Resolve the records a batch of notifications point at.
 *
 * The stored title and body are English, written for the delivery layer that P3-01 will
 * add (email, then WhatsApp). The screen renders from these resolved parts instead, so
 * an Arabic reader gets an Arabic sentence rather than an English one embedded in a
 * mirrored page.
 */
export async function resolveDocumentEntities(
  documentIds: string[],
): Promise<Map<string, ResolvedEntity>> {
  const resolved = new Map<string, ResolvedEntity>();
  if (documentIds.length === 0) return resolved;

  const documents = await prisma.document.findMany({
    where: { id: { in: documentIds }, deletedAt: null },
    select: {
      id: true,
      ownerType: true,
      ownerId: true,
      category: { select: { key: true, label: true, isSystem: true } },
    },
  });

  const idsOf = (type: string) =>
    documents.filter((d) => d.ownerType === type).map((d) => d.ownerId);

  const [customers, suppliers, vehicles, contracts] = await Promise.all([
    prisma.customer.findMany({
      where: { id: { in: idsOf("CUSTOMER") } },
      select: { id: true, code: true, fullName: true },
    }),
    prisma.supplier.findMany({
      where: { id: { in: idsOf("SUPPLIER") } },
      select: { id: true, code: true, companyName: true },
    }),
    prisma.vehicle.findMany({
      where: { id: { in: idsOf("VEHICLE") } },
      select: { id: true, code: true, make: true, model: true, plateCode: true, plateNumber: true },
    }),
    prisma.contract.findMany({
      where: { id: { in: idsOf("CONTRACT") } },
      select: { id: true, number: true, customer: { select: { fullName: true } } },
    }),
  ]);

  const owners = new Map<string, { label: string; href: string }>();
  for (const c of customers) {
    owners.set(`CUSTOMER:${c.id}`, {
      label: `${c.fullName} (${c.code})`,
      href: `/customers/${c.id}`,
    });
  }
  for (const s of suppliers) {
    owners.set(`SUPPLIER:${s.id}`, {
      label: `${s.companyName} (${s.code})`,
      href: `/suppliers/${s.id}`,
    });
  }
  for (const v of vehicles) {
    owners.set(`VEHICLE:${v.id}`, {
      label: `${v.make} ${v.model} · ${v.plateCode} ${v.plateNumber} (${v.code})`,
      href: `/vehicles/${v.id}`,
    });
  }

  for (const c of contracts) {
    owners.set(`CONTRACT:${c.id}`, {
      label: `${c.number} · ${c.customer.fullName}`,
      href: `/contracts/${c.id}`,
    });
  }

  for (const document of documents) {
    const owner = owners.get(`${document.ownerType}:${document.ownerId}`);
    if (!owner) continue;

    resolved.set(document.id, {
      href: owner.href,
      what: document.category.label,
      categoryKey: document.category.key,
      categoryIsSystem: document.category.isSystem,
      who: owner.label,
    });
  }

  return resolved;
}
