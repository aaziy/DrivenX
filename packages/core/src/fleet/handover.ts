/**
 * Giving the car out, and taking it back (P2-01, SOW §12).
 *
 * The two events are one shape. Both record an odometer, a fuel gauge, a condition and a
 * set of marks on the body, and both are signed by the customer and by staff. Keeping
 * them as one record with a direction rather than two models means the return report can
 * be laid against the handover report field for field, which is the only way the
 * difference between them — the thing actually being charged for at the end — is
 * demonstrable rather than asserted.
 *
 * Excess mileage is settled at return, not billed monthly (the client's answer of
 * 2026-09-17). The figure computed here is what the settlement screen offers; staff can
 * still change or waive it, because the charge is a negotiation and the system's job is
 * to know what the contract says, not to overrule the person standing at the counter.
 */

import type { Fils } from "../money/money";
import { excessKilometres } from "./mileage";

export type HandoverType = "HANDOVER" | "RETURN";

/**
 * Fuel is read off a gauge, and a gauge has eighths. Litres would be a false precision —
 * nobody drains the tank to measure it — and a percentage invites 63%, which no one can
 * verify from a photograph of the dashboard.
 */
export const FUEL_EIGHTHS_MAX = 8;

export function isValidFuelEighths(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= FUEL_EIGHTHS_MAX;
}

/** "5/8", for a form label and a PDF cell alike. */
export function formatFuelEighths(value: number): string {
  return `${value}/${FUEL_EIGHTHS_MAX}`;
}

export interface ExcessMileageInput {
  /** The odometer when the car went out. */
  handoverKm: number;
  /** The odometer when it came back. */
  returnKm: number;
  /** What the contract allows for the whole term. Null when the contract sets no limit. */
  allowanceKm: number | null;
  /** Charged per kilometre over, net of VAT. Null when the contract sets no rate. */
  rateFils: Fils | null;
}

export interface ExcessMileageResult {
  travelledKm: number;
  allowanceKm: number | null;
  excessKm: number;
  rateFils: Fils;
  /** Net; VAT is added when the settlement line is raised, as on every other charge. */
  netFils: Fils;
  /** Nothing to charge: within the allowance, or the contract set no limit or no rate. */
  chargeable: boolean;
}

/**
 * What the extra kilometres come to.
 *
 * A contract with no allowance or no rate charges nothing: an unlimited-mileage deal and
 * a deal whose rate was never agreed are both deals where DrivenX cannot produce the
 * number it is claiming, so the honest answer is zero rather than a guess.
 */
export function excessMileageCharge(input: ExcessMileageInput): ExcessMileageResult {
  const travelledKm = Math.max(0, input.returnKm - input.handoverKm);
  const rateFils = input.rateFils ?? 0n;

  if (input.allowanceKm === null || rateFils <= 0n) {
    return {
      travelledKm,
      allowanceKm: input.allowanceKm,
      excessKm: 0,
      rateFils,
      netFils: 0n,
      chargeable: false,
    };
  }

  const excessKm = excessKilometres(input.handoverKm, input.returnKm, input.allowanceKm);
  const netFils = BigInt(excessKm) * rateFils;

  return {
    travelledKm,
    allowanceKm: input.allowanceKm,
    excessKm,
    rateFils,
    netFils,
    chargeable: excessKm > 0,
  };
}

/**
 * Fuel returned below the level it went out at. Reported, never priced: the SOW asks for
 * the reading on both forms and says nothing about a refuelling charge, so the difference
 * is shown to staff and becomes a settlement line only if they decide it should.
 */
export function fuelShortfallEighths(handoverEighths: number, returnEighths: number): number {
  return Math.max(0, handoverEighths - returnEighths);
}
