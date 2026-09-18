/**
 * Odometer readings (P1B-08).
 *
 * An odometer only goes up. A reading lower than the last one is either a typo or a
 * tampered clock, and either way it must not become the vehicle's mileage: excess-mileage
 * charges are settled against it at return (the client's answer of 2026-09-17), so a
 * reading that goes backwards is money that goes missing.
 */

/** A car past this is not a car in a rental fleet; the reading has a digit too many. */
export const MAX_PLAUSIBLE_MILEAGE_KM = 1_500_000;

export type MileageIssueCode = "notWholeNumber" | "negative" | "implausible" | "backwards";

export type MileageValidation =
  | { valid: true }
  | { valid: false; code: MileageIssueCode; params?: Record<string, number> };

export function validateMileageReading(currentKm: number, readingKm: number): MileageValidation {
  if (!Number.isInteger(readingKm)) return { valid: false, code: "notWholeNumber" };
  if (readingKm < 0) return { valid: false, code: "negative" };
  if (readingKm > MAX_PLAUSIBLE_MILEAGE_KM) {
    return { valid: false, code: "implausible", params: { max: MAX_PLAUSIBLE_MILEAGE_KM } };
  }
  // Equal is allowed: a car read twice without moving has not gone backwards.
  if (readingKm < currentKm) {
    return { valid: false, code: "backwards", params: { current: currentKm } };
  }
  return { valid: true };
}

/** Kilometres driven over an allowance, never negative. The basis of excess-mileage charges. */
export function excessKilometres(startKm: number, endKm: number, allowanceKm: number): number {
  return Math.max(0, endKm - startKm - allowanceKm);
}
