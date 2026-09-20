/**
 * Document expiry rules (SOW §6, §11, §16) — milestone 1A.
 *
 * One engine for every expiring document: Emirates ID, driving licence, passport, visa,
 * trade licence, mulkiya and insurance policy all answer the same two questions. How
 * close is this to expiring, and which warning is due today?
 *
 * Pure functions, no database and no clock of their own: `now` is always passed in, so
 * every boundary can be tested exactly rather than approximately.
 */

import { businessDate, businessDaysBetween } from "../time";

/** Days before expiry at which to warn, per §6. */
export const DEFAULT_REMINDER_OFFSETS = [60, 30, 15, 7] as const;

export type ExpiryStatus = "no_expiry" | "valid" | "expiring" | "expired";

/** Whole days until expiry, counted in calendar days in Dubai. Negative once past. */
export function daysUntilExpiry(expiryDate: Date, now: Date): number {
  return businessDaysBetween(now, expiryDate);
}

/**
 * The state to show against a document.
 *
 * A document expiring today is `expiring`, not `expired`: it is still valid for the
 * whole of that day, and telling someone their customer's licence has expired while it
 * has not is how the alerts stop being trusted.
 */
export function expiryStatus(
  expiryDate: Date | null,
  reminderOffsets: readonly number[],
  now: Date,
): ExpiryStatus {
  if (!expiryDate) return "no_expiry";

  const days = daysUntilExpiry(expiryDate, now);
  if (days < 0) return "expired";

  const widest = reminderOffsets.length > 0 ? Math.max(...reminderOffsets) : 0;
  return days <= widest ? "expiring" : "valid";
}

/**
 * Which reminder offsets have been reached as of `now`, widest first.
 *
 * Returns every offset already crossed rather than only the nearest one. On a system
 * running daily that is exactly one new offset per firing, because the rest were raised
 * on earlier days and are suppressed by their dedupe keys. On a system that has been
 * down for a week, or a document uploaded when it is already inside the window, it
 * correctly raises everything outstanding instead of silently skipping warnings.
 */
export function dueReminderOffsets(
  expiryDate: Date | null,
  reminderOffsets: readonly number[],
  now: Date,
): number[] {
  if (!expiryDate) return [];

  const days = daysUntilExpiry(expiryDate, now);
  // Past expiry is its own alert, not a countdown warning.
  if (days < 0) return [];

  return [...new Set(reminderOffsets)]
    .filter((offset) => Number.isInteger(offset) && offset >= 0 && days <= offset)
    .sort((a, b) => b - a);
}

/**
 * Identity of one warning, so the nightly scan can run every day and raise each warning
 * exactly once. Without this the same expiry would be announced daily until somebody
 * stopped reading the notifications altogether.
 */
export function reminderDedupeKey(documentId: string, offset: number): string {
  return `document:${documentId}:reminder:${offset}`;
}

/**
 * Identity of the "this has expired" alert.
 *
 * Keyed by the expiry date as well as the document, so that renewing a document and
 * letting it lapse again raises a fresh alert rather than being mistaken for the old one.
 */
export function expiredDedupeKey(documentId: string, expiryDate: Date): string {
  return `document:${documentId}:expired:${businessDate(expiryDate)}`;
}

/**
 * When an insurance policy is worth mentioning: a month out, a fortnight, a week (P1D-12).
 *
 * Fixed rather than per-policy: a renewal is one conversation with one broker, and the
 * offsets a document category carries exist because a passport and a trade licence need
 * different lead times. Cover does not.
 */
export const INSURANCE_REMINDER_OFFSETS: readonly number[] = [30, 15, 7];

export function insuranceReminderDedupeKey(policyId: string, offset: number): string {
  return `insurance:${policyId}:reminder:${offset}`;
}

export function insuranceExpiredDedupeKey(policyId: string, expiryDate: Date): string {
  return `insurance:${policyId}:expired:${businessDate(expiryDate)}`;
}
