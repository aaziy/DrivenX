/**
 * Working out who to tell, and making sure they are told exactly once (P3-01).
 *
 * Two rules do all the work here.
 *
 * The first is that the people to email about a notification are exactly the people
 * entitled to see it. That rule already existed for the in-app list, and it is imported
 * rather than restated — a second copy would eventually disagree, and the copy that was
 * wrong would be the one mailing a customer's document details to somebody who should
 * not have them.
 *
 * The second is that a delivery row is claimed before anything is sent. The unique key
 * across notification, channel and recipient means a retried worker, or two workers
 * running at once, cannot produce two emails about the same expiring licence. This is
 * the same idea as the notification's own `dedupeKey`, one level down: that one stops a
 * nightly scan raising the same warning twice, this one stops it being *sent* twice.
 */

import type { DeliveryChannel } from "@drivenx/core";

import { prisma } from "./index";

/**
 * Somebody to reach, as resolved by whoever is doing the sending.
 *
 * Working out *who* needs the permission catalogue, and `@drivenx/auth` already depends
 * on this package — so that decision lives with the caller (see the worker's
 * `recipients.ts`) and this module stays the storage of the delivery log.
 */
export interface DeliveryRecipient {
  userId: string;
  email: string;
  fullName: string;
  locale: "en" | "ar";
}

export interface ClaimedDelivery {
  id: string;
  notificationId: string;
  channel: DeliveryChannel;
  userId: string | null;
  recipient: string;
  attempts: number;
}

/**
 * Claim the work of telling these people, and hand back only what was not already
 * claimed by somebody else.
 *
 * `skipDuplicates` against the unique key is what makes this safe to run twice: the
 * second run creates nothing and therefore sends nothing. The rows are then read back,
 * so a delivery left PENDING by a crashed run is picked up rather than stranded.
 */
export async function claimDeliveries(
  notificationId: string,
  channel: DeliveryChannel,
  recipients: DeliveryRecipient[],
): Promise<ClaimedDelivery[]> {
  if (recipients.length === 0) return [];

  await prisma.notificationDelivery.createMany({
    data: recipients.map((recipient) => ({
      notificationId,
      channel,
      userId: recipient.userId,
      recipient: recipient.email,
    })),
    skipDuplicates: true,
  });

  const pending = await prisma.notificationDelivery.findMany({
    where: {
      notificationId,
      channel,
      // SENT is finished. FAILED is left alone here: retrying is a decision, not a
      // side effect of the next run happening to come round.
      status: "PENDING",
      recipient: { in: recipients.map((recipient) => recipient.email) },
    },
    select: { id: true, notificationId: true, channel: true, userId: true, recipient: true, attempts: true },
  });

  return pending;
}

export async function markDelivered(deliveryId: string, detail?: string) {
  return prisma.notificationDelivery.update({
    where: { id: deliveryId },
    data: {
      status: "SENT",
      sentAt: new Date(),
      attempts: { increment: 1 },
      lastError: detail ?? null,
    },
  });
}

export async function markFailed(deliveryId: string, error: string, retryable: boolean) {
  return prisma.notificationDelivery.update({
    where: { id: deliveryId },
    data: {
      // A retryable failure stays PENDING so the next run picks it up; a permanent one
      // is closed, because trying a malformed address again is a loop with no end.
      status: retryable ? "PENDING" : "FAILED",
      attempts: { increment: 1 },
      lastError: error.slice(0, 500),
    },
  });
}

export async function markSkipped(
  notificationId: string,
  channel: DeliveryChannel,
  reason: string,
) {
  // Recorded rather than passed over in silence: "nobody was emailed about this" is an
  // answer somebody will eventually need, and an empty log cannot give it.
  return prisma.notificationDelivery.upsert({
    where: {
      notificationId_channel_recipient: { notificationId, channel, recipient: "-" },
    },
    create: { notificationId, channel, recipient: "-", status: "SKIPPED", lastError: reason },
    update: { status: "SKIPPED", lastError: reason },
  });
}

/**
 * Notifications still to be handled on this channel.
 *
 * "Still to be handled" is two cases, not one: never attempted, and attempted but left
 * PENDING by a failure worth retrying. Asking only for the first would strand every
 * retryable failure for ever, which is the opposite of what marking it retryable meant.
 *
 * The two are asked for separately rather than as "has no conclusive delivery", because
 * a notification going to several people can be sent to one of them and still pending
 * for another, and a single condition over the set cannot express that.
 *
 * Bounded by age as well as by count: a channel switched on for the first time should
 * announce what is happening now, not work through a year of history that everybody has
 * already seen on screen and acted on.
 */
export async function undeliveredNotifications(
  channel: DeliveryChannel,
  options: { since: Date; take?: number } = { since: new Date(Date.now() - 7 * 86_400_000) },
) {
  return prisma.notification.findMany({
    where: {
      createdAt: { gte: options.since },
      // Already dealt with on screen. Read marks a notification read for everybody (see
      // the notifications action), so this one has been handled and emailing about it
      // now is noise — which is what teaches people to ignore the next one.
      readAt: null,
      OR: [
        { deliveries: { none: { channel } } },
        { deliveries: { some: { channel, status: "PENDING" } } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: options.take ?? 200,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      dueOn: true,
      userId: true,
      entityType: true,
      entityId: true,
    },
  });
}
