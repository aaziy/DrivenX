/**
 * When a car is next due for service (P2-06, SOW §12).
 *
 * A garage gives two markers: a date and a distance, and whichever arrives first is the
 * one that matters. Both are optional — a tyre change sets neither — so a record with no
 * markers is never due and never nags.
 *
 * The warning distances are deliberately unequal. A date can be watched from a fortnight
 * out and acted on calmly; mileage arrives at whatever rate the car is driven, so 500 km
 * of notice is about a week of ordinary use and is the last point at which booking the
 * car in is still easy.
 */

import { compareIsoDates, type IsoDate } from "../contracts/calendar";

export const SERVICE_DATE_WARNING_DAYS = 14;
export const SERVICE_KM_WARNING = 500;

export interface ServiceMarkers {
  nextServiceOn: IsoDate | null;
  nextServiceKm: number | null;
}

export interface ServiceDue {
  /** Past its date or its distance: the service is late. */
  overdue: boolean;
  /** Close enough to book it in. */
  dueSoon: boolean;
  /** Days until the date marker, negative once passed; null without one. */
  daysRemaining: number | null;
  /** Kilometres until the distance marker, negative once passed; null without one. */
  kmRemaining: number | null;
}

const DAY_MS = 86_400_000;

export function serviceDue(
  markers: ServiceMarkers,
  at: { today: IsoDate; odometerKm: number },
): ServiceDue {
  const daysRemaining =
    markers.nextServiceOn === null
      ? null
      : Math.round(
          (Date.parse(`${markers.nextServiceOn}T00:00:00Z`) - Date.parse(`${at.today}T00:00:00Z`)) / DAY_MS,
        );
  const kmRemaining = markers.nextServiceKm === null ? null : markers.nextServiceKm - at.odometerKm;

  const overdue =
    (markers.nextServiceOn !== null && compareIsoDates(markers.nextServiceOn, at.today) < 0) ||
    (kmRemaining !== null && kmRemaining < 0);

  const dueSoon =
    !overdue &&
    ((daysRemaining !== null && daysRemaining <= SERVICE_DATE_WARNING_DAYS) ||
      (kmRemaining !== null && kmRemaining <= SERVICE_KM_WARNING));

  return { overdue, dueSoon, daysRemaining, kmRemaining };
}

/** Identity of a service reminder: one per record per state, so a nightly run repeats none. */
export function maintenanceDueDedupeKey(recordId: string, state: "due" | "overdue"): string {
  return `maintenance:${recordId}:${state}`;
}
