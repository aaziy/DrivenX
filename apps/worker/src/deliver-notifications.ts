/**
 * Send the notifications that have been raised but not yet delivered (P3-01, P3-02).
 *
 * A separate job from the ones that raise them, on purpose. Raising is a database
 * decision that must not be held up or rolled back by a mail server being slow, and
 * sending is an external call that will sometimes fail and need another go. Splitting
 * them means a flaky provider cannot stop the nightly scan from recording what it found.
 *
 * Everything that makes this safe to run twice lives in the delivery log: rows are
 * claimed before anything is sent, so a second run — or a second worker — finds nothing
 * left to claim and sends nothing.
 */

import { AVAILABLE_CHANNELS, businessDate } from "@drivenx/core";
import {
  claimDeliveries,
  markDelivered,
  markFailed,
  markSkipped,
  prisma,
  undeliveredNotifications,
  type DeliveryRecipient,
} from "@drivenx/db";
import { logger } from "@drivenx/logger";
import {
  emailAdapterFromEnv,
  renderDigest,
  renderNotification,
  type DigestItem,
  type NotificationChannelAdapter,
} from "@drivenx/notify";

import { recipientsFor } from "./recipients";

export interface DeliveryRunResult {
  /** Notifications examined. */
  considered: number;
  /** Messages sent — one per person, covering everything they were owed. */
  sent: number;
  failed: number;
  skipped: number;
}

/** How far back a first run will reach. See `undeliveredNotifications`. */
const LOOKBACK_DAYS = 7;

/** Where a notification's record lives, so the email can link to it. */
function urlFor(baseUrl: string, entityType: string, entityId: string): string | undefined {
  const path: Record<string, string> = {
    Document: "documents",
    InsurancePolicy: "vehicles",
    Vehicle: "vehicles",
    Contract: "contracts",
    Installment: "contracts",
    Customer: "customers",
    Supplier: "suppliers",
  };
  const segment = path[entityType];
  return segment ? `${baseUrl.replace(/\/$/, "")}/${segment}/${entityId}` : undefined;
}

export async function runDeliverNotifications(
  options: {
    now?: Date;
    adapter?: NotificationChannelAdapter;
    baseUrl?: string;
  } = {},
): Promise<DeliveryRunResult> {
  const now = options.now ?? new Date();
  const adapter = options.adapter ?? emailAdapterFromEnv();
  const baseUrl = options.baseUrl ?? process.env["APP_URL"] ?? "http://localhost:3000";

  const result: DeliveryRunResult = { considered: 0, sent: 0, failed: 0, skipped: 0 };

  if (!AVAILABLE_CHANNELS.includes("EMAIL") || !adapter.isConfigured()) {
    logger.warn("notification delivery skipped: no configured channel");
    return result;
  }

  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const notifications = await undeliveredNotifications("EMAIL", { since });
  result.considered = notifications.length;

  /** What each person is owed this run, gathered before anything is sent. */
  const pending = new Map<
    string,
    { recipient: DeliveryRecipient; deliveryIds: string[]; items: DigestItem[] }
  >();

  for (const notification of notifications) {
    let recipients: DeliveryRecipient[] = [];
    try {
      recipients = await recipientsFor(notification);
    } catch (error) {
      logger.error("could not resolve recipients", { notificationId: notification.id, error });
      continue;
    }

    if (recipients.length === 0) {
      // Recorded, not passed over: "nobody was emailed about this" is a question
      // somebody will ask, and an empty log cannot answer it.
      await markSkipped(notification.id, "EMAIL", "no recipient");
      result.skipped += 1;
      continue;
    }

    const claimed = await claimDeliveries(notification.id, "EMAIL", recipients);
    const byEmail = new Map(recipients.map((recipient) => [recipient.email, recipient]));

    for (const delivery of claimed) {
      const recipient = byEmail.get(delivery.recipient);
      if (!recipient) continue;

      const forThisPerson = pending.get(delivery.recipient) ?? {
        recipient,
        deliveryIds: [],
        items: [],
      };
      forThisPerson.deliveryIds.push(delivery.id);
      forThisPerson.items.push({
        type: notification.type,
        title: notification.title,
        body: notification.body,
        dueOn: notification.dueOn ? businessDate(notification.dueOn) : undefined,
        url: urlFor(baseUrl, notification.entityType, notification.entityId),
      });
      pending.set(delivery.recipient, forThisPerson);
    }
  }

  // One message per person, however many things are waiting for them (P3-04). Ten
  // documents expiring in the same week would otherwise be ten emails on one morning,
  // and the reliable answer to that is a filter rule — after which the eleventh, which
  // mattered, goes unread too.
  for (const [address, batch] of pending) {
    const message =
      batch.items.length === 1 && batch.items[0]
        ? renderNotification({
            type: batch.items[0].type,
            locale: batch.recipient.locale,
            title: batch.items[0].title,
            body: batch.items[0].body,
            dueOn: batch.items[0].dueOn,
            url: batch.items[0].url,
          })
        : renderDigest({ locale: batch.recipient.locale, items: batch.items });

    const outcome = await adapter.send({ recipient: address, message, locale: batch.recipient.locale });

    for (const deliveryId of batch.deliveryIds) {
      if (outcome.ok) {
        await markDelivered(deliveryId, outcome.detail);
      } else {
        await markFailed(deliveryId, outcome.error, outcome.retryable);
      }
    }

    if (outcome.ok) {
      result.sent += 1;
    } else {
      result.failed += 1;
      logger.warn("notification delivery failed", {
        recipient: address,
        covering: batch.deliveryIds.length,
        retryable: outcome.retryable,
        error: outcome.error,
      });
    }
  }

  return result;
}

export async function runDeliverNotificationsLogged(): Promise<void> {
  const started = Date.now();
  const result = await runDeliverNotifications();
  logger.info("notification delivery finished", { ...result, ms: Date.now() - started });
  await prisma.$disconnect();
}
