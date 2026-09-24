/**
 * Who is entitled to see which notification (P1A-08, shared for delivery in P3-01).
 *
 * A notification with no `userId` is addressed to "everyone who holds the relevant
 * permission" (see the schema). That phrase has to become an actual rule, or finance is
 * shown fleet maintenance alerts and sales is shown supplier payables.
 *
 * It lives here rather than in the web app because delivery needs the same answer: the
 * list of people to email about a notification is the list of people entitled to see it,
 * and two copies of that rule would eventually disagree — with the copy that is wrong
 * being the one that sends a customer's document details to somebody who should not have
 * them.
 */

import { NOTIFICATION_TYPES, type NotificationType } from "@drivenx/core";

import { can, type Principal } from "./rbac";
import type { PermissionKey } from "./permissions";

const VISIBILITY: Record<NotificationType, PermissionKey> = {
  DOCUMENT_EXPIRY: "document.view",
  INSURANCE_EXPIRY: "insurance.view",
  PAYMENT_DUE: "payment.view",
  PAYMENT_OVERDUE: "payment.view",
  CONTRACT_EXPIRY: "contract.view",
  MAINTENANCE_DUE: "maintenance.view",
  SUPPLIER_PAYMENT_DUE: "supplier_invoice.view",
};

/** The permission that entitles somebody to see this kind of notification. */
export function notificationPermission(type: NotificationType): PermissionKey {
  return VISIBILITY[type];
}

export function visibleNotificationTypes(principal: Principal): NotificationType[] {
  return NOTIFICATION_TYPES.filter((type) => can(principal, VISIBILITY[type]));
}

/** Whether this person may be told about this notification at all, on any channel. */
export function mayReceiveNotification(
  principal: Principal,
  notification: { type: NotificationType; userId: string | null },
): boolean {
  if (!can(principal, VISIBILITY[notification.type])) return false;
  // Addressed to one person, or to everyone entitled.
  return notification.userId === null || notification.userId === principal.id;
}
