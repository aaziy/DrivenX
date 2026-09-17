/**
 * Business-day arithmetic.
 *
 * Almost every date question in DrivenX is a calendar-day question asked in Dubai, not
 * an elapsed-time question. A document expiring "in 30 days" must raise its 30-day
 * warning on the right calendar day whether the nightly job runs at 00:05 or at 23:55,
 * and an instalment due on the 1st is due on the 1st as read in the office.
 *
 * The UAE does not observe daylight saving, so Gulf Standard Time is a fixed UTC+4 all
 * year. That reduces the arithmetic to a constant offset instead of a timezone database.
 * The constant is here, alone and named, because that assumption is the whole reason
 * this is safe: if DrivenX ever operates somewhere that shifts its clocks, this must be
 * replaced with a real timezone implementation rather than patched.
 */

export const BUSINESS_UTC_OFFSET_HOURS = 4;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The calendar date in Dubai for an instant, as `YYYY-MM-DD`. */
export function businessDate(instant: Date): string {
  return new Date(instant.getTime() + BUSINESS_UTC_OFFSET_HOURS * HOUR_MS)
    .toISOString()
    .slice(0, 10);
}

/** The instant of Dubai midnight that begins the day containing `instant`. */
export function startOfBusinessDay(instant: Date): Date {
  const shifted = instant.getTime() + BUSINESS_UTC_OFFSET_HOURS * HOUR_MS;
  const flooredToDay = Math.floor(shifted / DAY_MS) * DAY_MS;
  return new Date(flooredToDay - BUSINESS_UTC_OFFSET_HOURS * HOUR_MS);
}

/**
 * Whole calendar days from one instant's Dubai day to another's; negative when `to`
 * falls earlier. Both ends are reduced to their day first, so the result never depends
 * on the time of day either instant carries.
 */
export function businessDaysBetween(from: Date, to: Date): number {
  const difference = startOfBusinessDay(to).getTime() - startOfBusinessDay(from).getTime();
  return Math.round(difference / DAY_MS);
}
