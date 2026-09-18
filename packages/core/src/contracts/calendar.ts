/**
 * Calendar dates for schedules — "YYYY-MM-DD", never a Date.
 *
 * An instalment is due on a day, not at an instant. A JavaScript Date is an instant, and
 * turning one into a day depends on the time zone of whichever machine does it — the
 * classic way a due date slides to the day before on a server running in UTC. Dates here
 * are plain calendar days, so there is no time zone to get wrong.
 */

export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface CalendarDay {
  year: number;
  month: number; // 1–12
  day: number;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseIsoDate(value: IsoDate): CalendarDay {
  const match = ISO_DATE.exec(value);
  if (!match) throw new RangeError(`Not a YYYY-MM-DD date: ${value}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Not a real calendar date: ${value}`);
  }
  return { year, month, day };
}

export function isIsoDate(value: string): boolean {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

export function formatIsoDate({ year, month, day }: CalendarDay): IsoDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The date `months` after `start`, keeping the start's day of the month where it exists
 * and falling back to the last day where it does not.
 *
 * Always computed from the start, never chained from the previous result: a contract that
 * starts on 31 January is due on 28 (or 29) February and then 31 March. Chaining would
 * carry the 28th forward and every later due date would drift to the 28th.
 */
export function addMonths(start: IsoDate, months: number): IsoDate {
  const { year, month, day } = parseIsoDate(start);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  return formatIsoDate({
    year: targetYear,
    month: targetMonth,
    day: Math.min(day, daysInMonth(targetYear, targetMonth)),
  });
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const { year, month, day } = parseIsoDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatIsoDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

/** YYYY-MM-DD strings sort as dates; this makes the intent explicit at call sites. */
export function compareIsoDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** YYYYMM — the ledger's reporting period (IMPLEMENTATION_PLAN §10). */
export function periodMonthOf(date: IsoDate): number {
  const { year, month } = parseIsoDate(date);
  return year * 100 + month;
}
