/**
 * The kinds of notification the system raises (P1A-08, extended in P3-01).
 *
 * Mirrors the `NotificationType` enum in the Prisma schema, as a list rather than a bare
 * union so that everything which must cover every type — the visibility rule, the email
 * templates, the message catalogues — can iterate it and be checked for gaps. A type
 * added without a template would otherwise reach somebody's inbox as a blank subject.
 */

export const NOTIFICATION_TYPES = [
  "DOCUMENT_EXPIRY",
  "INSURANCE_EXPIRY",
  "PAYMENT_DUE",
  "PAYMENT_OVERDUE",
  "CONTRACT_EXPIRY",
  "MAINTENANCE_DUE",
  "SUPPLIER_PAYMENT_DUE",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

/**
 * The channels a notification can go out on (P3-01, SOW §16).
 *
 * In-app always happens — it is the notification row itself, and it is the only one that
 * cannot fail or be switched off, so it is the record that something was raised at all.
 * The rest are attempts to reach someone who is not looking at the screen.
 */
export const DELIVERY_CHANNELS = ["IN_APP", "EMAIL", "WHATSAPP", "SMS"] as const;

export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/** Built and switchable today. WhatsApp and SMS are Phase 3 work still to come. */
export const AVAILABLE_CHANNELS: readonly DeliveryChannel[] = ["IN_APP", "EMAIL"];
