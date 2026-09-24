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
import { emailAdapterFromEnv, renderNotification, type NotificationChannelAdapter } from "@drivenx/notify";

import { recipientsFor } from "./recipients";

export interface DeliveryRunResult {
  considered: number;
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

      const message = renderNotification({
        type: notification.type,
        locale: recipient.locale,
        title: notification.title,
        body: notification.body,
        dueOn: notification.dueOn ? businessDate(notification.dueOn) : undefined,
        url: urlFor(baseUrl, notification.entityType, notification.entityId),
      });

      const outcome = await adapter.send({
        recipient: delivery.recipient,
        message,
        locale: recipient.locale,
      });

      if (outcome.ok) {
        await markDelivered(delivery.id, outcome.detail);
        result.sent += 1;
      } else {
        await markFailed(delivery.id, outcome.error, outcome.retryable);
        result.failed += 1;
        logger.warn("notification delivery failed", {
          notificationId: notification.id,
          recipient: delivery.recipient,
          retryable: outcome.retryable,
          error: outcome.error,
        });
      }
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
