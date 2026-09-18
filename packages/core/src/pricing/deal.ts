/**
 * The deal calculator (P1C-01, SOW §8).
 *
 * A pure function, not a screen with arithmetic in it. The same function serves the sales
 * quote, the contract preview and the projected-profit report, so there is one
 * implementation and one set of tests and the three can never disagree.
 *
 * Two anchors, both from the SOW and both pinned as tests:
 *   §8 — supplier 2,400 · customer 3,500 · 36 months → 1,100 a month, 39,600 in total.
 *   Key Financial Logic — supplier 2,300 · customer 3,400 · insurance 2,500 a year →
 *     1,100 a month, 40,800 annual rental, 43,300 first year including insurance.
 * The SOW's "gross profit" is rental minus the vehicle's monthly cost, and nothing else;
 * `monthly.grossProfit` is exactly that. The rest of the breakdown adds what the SOW's
 * examples leave out — insurance on both sides, maintenance, the down payment, one-off
 * costs, the lease-to-own buyout — as `contract.totalProfit`.
 *
 * Everything is net of VAT. VAT is collected for the FTA and is never revenue (INV-4);
 * the one VAT figure here, `monthly.rentalWithVat`, is what the customer is quoted.
 */

import { add, allocate, multiply, percentage, subtract, sum, ZERO, type Fils } from "../money/money";
import { divideRound, RoundingMode } from "../money/rounding";
import type { VehicleOwnership } from "../fleet/status";

export type DealType = "RENTAL" | "LEASE_TO_OWN";

/** 120 months is the longest term the plan provides for; anything longer is a typo. */
export const MAX_DEAL_MONTHS = 120;

/** VAT added on top of the net price (client, 2026-09-17). */
export const VAT_PERCENT = 5;

/** The final payment that transfers ownership at the end of a lease-to-own (client, 2026-09-17). */
export const LEASE_TO_OWN_BUYOUT: Fils = 100_000n;

export interface DealInput {
  dealType: DealType;
  ownership: VehicleOwnership;
  durationMonths: number;
  /** What the customer pays each month, net of VAT. */
  customerMonthlyRental: Fils;
  /** What the car costs DrivenX each month — the supplier's lease, for a leased-in car. */
  vehicleMonthlyCost?: Fils;
  /** A one-off vehicle cost, such as the purchase price of a company car handed over at the end of a lease-to-own. */
  vehicleOneOffCost?: Fils;
  /** Taken at the start and not refunded, so it is revenue (client, 2026-09-17). */
  downPayment?: Fils;
  /** Lease-to-own only: the final payment, received at the end. */
  buyoutAmount?: Fils;
  /** Charged to the customer, per year. */
  annualInsuranceCharge?: Fils;
  /** Paid by DrivenX to the insurer, per year. */
  annualInsuranceCost?: Fils;
  monthlyMaintenanceCost?: Fils;
  /** Anything else, once, for the whole deal. */
  otherCosts?: Fils;
}

export type DealIssueCode =
  | "durationNotWholeNumber"
  | "durationTooShort"
  | "durationTooLong"
  | "negativeAmount"
  | "rentalOnLeasedCar"
  | "buyoutOnRental";

export interface DealIssue {
  code: DealIssueCode;
  field?: keyof DealInput;
  params?: Record<string, number>;
}

export class DealValidationError extends Error {
  constructor(readonly issues: DealIssue[]) {
    super(`Deal input is invalid: ${issues.map((issue) => issue.code).join(", ")}`);
    this.name = "DealValidationError";
  }
}

const MONEY_FIELDS = [
  "customerMonthlyRental",
  "vehicleMonthlyCost",
  "vehicleOneOffCost",
  "downPayment",
  "buyoutAmount",
  "annualInsuranceCharge",
  "annualInsuranceCost",
  "monthlyMaintenanceCost",
  "otherCosts",
] as const satisfies readonly (keyof DealInput)[];

/** Every problem at once, as codes the form can show in the reader's language. */
export function validateDealInput(input: DealInput): DealIssue[] {
  const issues: DealIssue[] = [];
  const months = input.durationMonths;

  if (!Number.isInteger(months)) {
    issues.push({ code: "durationNotWholeNumber", field: "durationMonths" });
  } else if (months < 1) {
    issues.push({ code: "durationTooShort", field: "durationMonths" });
  } else if (months > MAX_DEAL_MONTHS) {
    issues.push({ code: "durationTooLong", field: "durationMonths", params: { max: MAX_DEAL_MONTHS } });
  }

  for (const field of MONEY_FIELDS) {
    const value = input[field];
    if (value !== undefined && value < ZERO) issues.push({ code: "negativeAmount", field });
  }

  // The fleet rule, restated where a deal is priced: a car leased from a supplier goes to
  // a customer only on lease-to-own (client, 2026-09-18).
  if (input.dealType === "RENTAL" && input.ownership === "B2B_SUPPLIER") {
    issues.push({ code: "rentalOnLeasedCar", field: "dealType" });
  }

  if (input.dealType === "RENTAL" && (input.buyoutAmount ?? ZERO) > ZERO) {
    issues.push({ code: "buyoutOnRental", field: "buyoutAmount" });
  }

  return issues;
}

export interface DealBreakdown {
  monthly: {
    rentalRevenue: Fils;
    vehicleCost: Fils;
    maintenanceCost: Fils;
    /** Rental minus the vehicle's monthly cost — the SOW's figure, and nothing else. */
    grossProfit: Fils;
    /** What the customer is quoted each month, VAT included. */
    rentalWithVat: Fils;
  };
  firstYear: {
    /** Twelve, or the whole term if it is shorter. */
    months: number;
    rentalRevenue: Fils;
    insuranceRevenue: Fils;
    revenueIncludingInsurance: Fils;
  };
  contract: {
    months: number;
    rentalRevenue: Fils;
    insuranceRevenue: Fils;
    downPayment: Fils;
    buyout: Fils;
    totalRevenue: Fils;
    vehicleCost: Fils;
    insuranceCost: Fils;
    maintenanceCost: Fils;
    otherCosts: Fils;
    totalCost: Fils;
    /** The SOW's monthly gross profit over the whole term. */
    grossProfitFromRental: Fils;
    /** Everything in, everything out. Negative when the deal loses money — never clamped. */
    totalProfit: Fils;
    /** Profit as a share of revenue, in basis points (1,000 is 10.00%). Null when there is no revenue. */
    marginBasisPoints: number | null;
  };
}

/**
 * An annual amount spread over a number of months, exactly.
 *
 * Split into twelve monthly shares by largest remainder, then taken month by month, so a
 * full year is exactly the annual figure and a partial year is exactly the months it
 * covers — 2,500 over thirteen months is 2,500 plus one 208.34, not 2,708.333… rounded
 * somewhere.
 */
export function annualOverMonths(annual: Fils, months: number): Fils {
  if (annual === ZERO || months <= 0) return ZERO;
  const shares = allocate(annual, 12);
  let total = ZERO;
  for (let month = 0; month < months; month += 1) {
    total += shares[month % 12]!;
  }
  return total;
}

export function calculateDeal(input: DealInput): DealBreakdown {
  const issues = validateDealInput(input);
  if (issues.length > 0) throw new DealValidationError(issues);

  const months = input.durationMonths;
  const rental = input.customerMonthlyRental;
  const vehicleMonthly = input.vehicleMonthlyCost ?? ZERO;
  const maintenanceMonthly = input.monthlyMaintenanceCost ?? ZERO;
  const annualInsuranceCharge = input.annualInsuranceCharge ?? ZERO;
  const annualInsuranceCost = input.annualInsuranceCost ?? ZERO;

  const grossProfit = subtract(rental, vehicleMonthly);

  const firstYearMonths = Math.min(12, months);
  const firstYearRental = multiply(rental, firstYearMonths);
  const firstYearInsurance = annualOverMonths(annualInsuranceCharge, firstYearMonths);

  const rentalRevenue = multiply(rental, months);
  const insuranceRevenue = annualOverMonths(annualInsuranceCharge, months);
  const downPayment = input.downPayment ?? ZERO;
  const buyout = input.dealType === "LEASE_TO_OWN" ? (input.buyoutAmount ?? ZERO) : ZERO;
  const totalRevenue = sum([rentalRevenue, insuranceRevenue, downPayment, buyout]);

  const vehicleCost = add(multiply(vehicleMonthly, months), input.vehicleOneOffCost ?? ZERO);
  const insuranceCost = annualOverMonths(annualInsuranceCost, months);
  const maintenanceCost = multiply(maintenanceMonthly, months);
  const otherCosts = input.otherCosts ?? ZERO;
  const totalCost = sum([vehicleCost, insuranceCost, maintenanceCost, otherCosts]);

  const totalProfit = subtract(totalRevenue, totalCost);

  return {
    monthly: {
      rentalRevenue: rental,
      vehicleCost: vehicleMonthly,
      maintenanceCost: maintenanceMonthly,
      grossProfit,
      rentalWithVat: add(rental, percentage(rental, VAT_PERCENT)),
    },
    firstYear: {
      months: firstYearMonths,
      rentalRevenue: firstYearRental,
      insuranceRevenue: firstYearInsurance,
      revenueIncludingInsurance: add(firstYearRental, firstYearInsurance),
    },
    contract: {
      months,
      rentalRevenue,
      insuranceRevenue,
      downPayment,
      buyout,
      totalRevenue,
      vehicleCost,
      insuranceCost,
      maintenanceCost,
      otherCosts,
      totalCost,
      grossProfitFromRental: multiply(grossProfit, months),
      totalProfit,
      marginBasisPoints:
        totalRevenue > ZERO
          ? Number(divideRound(totalProfit * 10_000n, totalRevenue, RoundingMode.HALF_UP))
          : null,
    },
  };
}
