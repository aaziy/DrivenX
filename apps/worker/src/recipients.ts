/**
 * Who should be told about a notification (P3-01).
 *
 * The people to email are exactly the people entitled to see it in the app. That rule
 * lives in `@drivenx/auth` and is imported rather than restated, because a second copy
 * would eventually disagree — and the copy that was wrong would be the one mailing a
 * customer's document details to somebody who should not have them.
 *
 * It lives here rather than in `@drivenx/db` because answering it needs the permission
 * catalogue, and `@drivenx/auth` already depends on `@drivenx/db`. Putting it there
 * would have made the two packages depend on each other.
 */

import { buildPrincipal, mayReceiveNotification } from "@drivenx/auth";
import type { NotificationType } from "@drivenx/core";
import { prisma, type DeliveryRecipient } from "@drivenx/db";

/**
 * Inactive people are left out: an account that cannot sign in cannot act on an alert,
 * and mailing a leaver is how a former employee keeps learning about the fleet.
 */
export async function recipientsFor(notification: {
  type: NotificationType;
  userId: string | null;
}): Promise<DeliveryRecipient[]> {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      emailNotifications: true,
      ...(notification.userId ? { id: notification.userId } : {}),
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      locale: true,
      isActive: true,
      roles: {
        select: {
          role: { select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } },
        },
      },
    },
  });

  return users
    .filter((user) =>
      mayReceiveNotification(
        buildPrincipal({
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          isActive: user.isActive,
          roles: user.roles.map((assignment) => ({
            key: assignment.role.key,
            permissions: assignment.role.permissions.map((granted) => granted.permission.key),
          })),
        }),
        notification,
      ),
    )
    .map((user) => ({
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      locale: user.locale === "ar" ? ("ar" as const) : ("en" as const),
    }));
}
