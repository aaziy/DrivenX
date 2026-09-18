/**
 * Contract schedules (P1D-03, P1D-04, SOW §9–§11).
 *
 * A contract is a list of charges, not a row of fixed columns (§3.4 of the plan). Rental,
 * insurance, the down payment and the lease-to-own buyout are each a charge with its own
 * recurrence, and one expansion turns any mix of them into instalments. Long-term rental,
 * lease-to-own and B2B rental differ only in which charges they carry.
 *
 * INV-1 lives here: the instalments of a charge sum to exactly what the charge is worth,
 * to the fil. INV-10 lives here too: every instalment carries its own VAT rate, so a
 * future change of rate cannot rewrite an invoice already issued.
 *
 * The same annual-over-months split as the deal calculator is used for insurance, so a
 * contract schedules exactly the revenue the quote promised — the two are tested together.
 */

import { ZERO, type Fils } from "../money/money";
import { divideRound, RoundingMode } from "../money/rounding";
import { annualOverMonths } from "../pricing/deal";
import { addDays, addMonths, type IsoDate } from "./calendar";

export type ChargeType =
  | "MONTHLY_RENTAL"
  | "ANNUAL_INSURANCE"
  | "DOWN_PAYMENT"
  | "ADMIN_FEE"
  | "BUYOUT"
  | "OTHER";

export type Recurrence = "ONCE" | "MONTHLY" | "ANNUAL";

/** 5% in basis points — the UAE standard rate (client, 2026-09-17). */
export const STANDARD_VAT_BASIS_POINTS = 500;

export interface OneOffCharge {
  chargeType: "ADMIN_FEE" | "OTHER";
  label: string;
  amount: Fils;
  dueOn: IsoDate;
}

export interface ContractTerms {
  startDate: IsoDate;
  durationMonths: number;
  /** Net of VAT, as everywhere in contract amounts (client, 2026-09-17). */
  monthlyRental: Fils;
  downPayment?: Fils;
  /** Lease-to-own: the final payment that transfers ownership, due on the last day. */
  buyout?: Fils;
  /** Per year, billed once a year; a final part year is charged for the months it covers. */
  annualInsurance?: Fils;
  oneOffCharges?: OneOffCharge[];
  vatBasisPoints?: number;
}

export interface ScheduledCharge {
  key: string;
  chargeType: ChargeType;
  label: string;
  recurrence: Recurrence;
  /** Net, per full occurrence. */
  amount: Fils;
  startsOn: IsoDate;
  occurrences: number;
  vatBasisPoints: number;
}

export interface ScheduledInstallment {
  chargeKey: string;
  chargeType: ChargeType;
  /** 1-based, within its charge. */
  sequence: number;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  dueDate: IsoDate;
  netFils: Fils;
  vatBasisPoints: number;
  vatFils: Fils;
  grossFils: Fils;
}

/** The last day of the contract: the day before the month after the final period starts. */
export function contractEndDate(startDate: IsoDate, durationMonths: number): IsoDate {
  return addDays(addMonths(startDate, durationMonths), -1);
}

/** VAT on one net amount, rounded half-up once — at the instalment, where it is invoiced. */
export function vatOn(net: Fils, basisPoints: number): Fils {
  return divideRound(net * BigInt(basisPoints), 10_000n, RoundingMode.HALF_UP);
}

/** The charges a contract's terms compose into. Zero-amount charges are left out. */
export function chargesFor(terms: ContractTerms): ScheduledCharge[] {
  const vat = terms.vatBasisPoints ?? STANDARD_VAT_BASIS_POINTS;
  const charges: ScheduledCharge[] = [];

  if ((terms.downPayment ?? ZERO) > ZERO) {
    charges.push({
      key: "down-payment",
      chargeType: "DOWN_PAYMENT",
      label: "Down payment",
      recurrence: "ONCE",
      amount: terms.downPayment!,
      startsOn: terms.startDate,
      occurrences: 1,
      vatBasisPoints: vat,
    });
  }

  charges.push({
    key: "rental",
    chargeType: "MONTHLY_RENTAL",
    label: "Monthly rental",
    recurrence: "MONTHLY",
    amount: terms.monthlyRental,
    startsOn: terms.startDate,
    occurrences: terms.durationMonths,
    vatBasisPoints: vat,
  });

  if ((terms.annualInsurance ?? ZERO) > ZERO) {
    charges.push({
      key: "insurance",
      chargeType: "ANNUAL_INSURANCE",
      label: "Insurance",
      recurrence: "ANNUAL",
      amount: terms.annualInsurance!,
      startsOn: terms.startDate,
      occurrences: Math.ceil(terms.durationMonths / 12),
      vatBasisPoints: vat,
    });
  }

  if ((terms.buyout ?? ZERO) > ZERO) {
    charges.push({
      key: "buyout",
      chargeType: "BUYOUT",
      label: "Buyout",
      recurrence: "ONCE",
      amount: terms.buyout!,
      startsOn: contractEndDate(terms.startDate, terms.durationMonths),
      occurrences: 1,
      vatBasisPoints: vat,
    });
  }

  for (const [index, charge] of (terms.oneOffCharges ?? []).entries()) {
    if (charge.amount <= ZERO) continue;
    charges.push({
      key: `one-off-${index + 1}`,
      chargeType: charge.chargeType,
      label: charge.label,
      recurrence: "ONCE",
      amount: charge.amount,
      startsOn: charge.dueOn,
      occurrences: 1,
      vatBasisPoints: vat,
    });
  }

  return charges;
}

function installment(
  charge: ScheduledCharge,
  sequence: number,
  periodStart: IsoDate,
  periodEnd: IsoDate,
  netFils: Fils,
): ScheduledInstallment {
  const vatFils = vatOn(netFils, charge.vatBasisPoints);
  return {
    chargeKey: charge.key,
    chargeType: charge.chargeType,
    sequence,
    periodStart,
    periodEnd,
    // Charged in advance: each period is due on its first day.
    dueDate: periodStart,
    netFils,
    vatBasisPoints: charge.vatBasisPoints,
    vatFils,
    grossFils: netFils + vatFils,
  };
}

/**
 * One charge as its instalments.
 *
 * `durationMonths` is needed for an annual charge's final part year, which is charged
 * for exactly the months it covers.
 */
export function expandCharge(charge: ScheduledCharge, durationMonths: number): ScheduledInstallment[] {
  switch (charge.recurrence) {
    case "ONCE":
      return [installment(charge, 1, charge.startsOn, charge.startsOn, charge.amount)];

    case "MONTHLY":
      return Array.from({ length: charge.occurrences }, (_, index) =>
        installment(
          charge,
          index + 1,
          addMonths(charge.startsOn, index),
          addDays(addMonths(charge.startsOn, index + 1), -1),
          charge.amount,
        ),
      );

    case "ANNUAL":
      return Array.from({ length: charge.occurrences }, (_, year) => {
        const firstMonth = year * 12;
        const monthsCovered = Math.min(12, durationMonths - firstMonth);
        return installment(
          charge,
          year + 1,
          addMonths(charge.startsOn, firstMonth),
          addDays(addMonths(charge.startsOn, firstMonth + monthsCovered), -1),
          // A full year is the annual amount; a part year is exactly its months, split the
          // same way the deal calculator splits it.
          monthsCovered === 12 ? charge.amount : annualOverMonths(charge.amount, monthsCovered),
        );
      });
  }
}

const TYPE_ORDER: Record<ChargeType, number> = {
  DOWN_PAYMENT: 0,
  ADMIN_FEE: 1,
  MONTHLY_RENTAL: 2,
  ANNUAL_INSURANCE: 3,
  OTHER: 4,
  BUYOUT: 5,
};

/** Every instalment of every charge, in the order they fall due. */
export function expandCharges(
  charges: readonly ScheduledCharge[],
  durationMonths: number,
): ScheduledInstallment[] {
  return charges
    .flatMap((charge) => expandCharge(charge, durationMonths))
    .sort(
      (a, b) =>
        (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0) ||
        TYPE_ORDER[a.chargeType] - TYPE_ORDER[b.chargeType] ||
        a.sequence - b.sequence,
    );
}

export function buildSchedule(terms: ContractTerms): ScheduledInstallment[] {
  return expandCharges(chargesFor(terms), terms.durationMonths);
}

export interface ScheduleTotals {
  netFils: Fils;
  vatFils: Fils;
  grossFils: Fils;
}

export function scheduleTotals(installments: readonly ScheduledInstallment[]): ScheduleTotals {
  let netFils = ZERO;
  let vatFils = ZERO;
  for (const item of installments) {
    netFils += item.netFils;
    vatFils += item.vatFils;
  }
  return { netFils, vatFils, grossFils: netFils + vatFils };
}
