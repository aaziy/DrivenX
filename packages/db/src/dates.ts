/**
 * Between calendar days (`YYYY-MM-DD`, used by every schedule rule in @drivenx/core) and
 * the `@db.Date` columns that store them.
 *
 * Prisma hands a DATE column back as a Date at UTC midnight. Reading its day with local
 * time methods on a server west of UTC would land on the day before, so both directions
 * go through UTC explicitly.
 */

import type { IsoDate } from "@drivenx/core";

export function toDbDate(date: IsoDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function fromDbDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}
