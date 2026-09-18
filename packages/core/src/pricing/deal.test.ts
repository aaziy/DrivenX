import { describe, expect, it } from "vitest";

import { parse } from "../money/money";
import {
  annualOverMonths,
  calculateDeal,
  DealValidationError,
  LEASE_TO_OWN_BUYOUT,
  MAX_DEAL_MONTHS,
  validateDealInput,
  type DealInput,
} from "./deal";

const aed = (value: string) => parse(value);

/** A lease-to-own of a leased-in car with nothing but rent and supplier cost. */
function deal(overrides: Partial<DealInput> = {}): DealInput {
  return {
    dealType: "LEASE_TO_OWN",
    ownership: "B2B_SUPPLIER",
    durationMonths: 36,
    customerMonthlyRental: aed("3500"),
    vehicleMonthlyCost: aed("2400"),
    ...overrides,
  };
}

/**
 * The only externally verifiable numbers in the SOW. If a change breaks either block,
 * the money is broken — these are the regression anchor for the whole financial engine.
 */
describe("the SOW's worked examples", () => {
  it("§8: supplier 2,400 · customer 3,500 · 36 months → 1,100 a month, 39,600 in total", () => {
    const result = calculateDeal(deal());

    expect(result.monthly.grossProfit).toBe(aed("1100"));
    expect(result.contract.grossProfitFromRental).toBe(aed("39600"));
  });

  it("Key Financial Logic: 2,300 · 3,400 · insurance 2,500 → 1,100, 40,800, 43,300", () => {
    const result = calculateDeal(
      deal({
        customerMonthlyRental: aed("3400"),
        vehicleMonthlyCost: aed("2300"),
        annualInsuranceCharge: aed("2500"),
      }),
    );

    expect(result.monthly.grossProfit).toBe(aed("1100"));
    expect(result.firstYear.rentalRevenue).toBe(aed("40800"));
    expect(result.firstYear.revenueIncludingInsurance).toBe(aed("43300"));
  });

  it("quotes the customer 3,570 for 3,400 net — VAT on top, margin unchanged", () => {
    // Recorded in the plan when VAT was answered: the SOW's figures are net.
    const result = calculateDeal(deal({ customerMonthlyRental: aed("3400"), vehicleMonthlyCost: aed("2300") }));
    expect(result.monthly.rentalWithVat).toBe(aed("3570"));
    expect(result.monthly.grossProfit).toBe(aed("1100"));
  });
});

describe("the full contract", () => {
  it("counts the down payment as revenue — it is not refunded", () => {
    const result = calculateDeal(deal({ downPayment: aed("5000") }));
    expect(result.contract.downPayment).toBe(aed("5000"));
    expect(result.contract.totalProfit).toBe(aed("44600"));
  });

  it("adds the lease-to-own buyout at the end", () => {
    const result = calculateDeal(deal({ buyoutAmount: LEASE_TO_OWN_BUYOUT }));
    expect(LEASE_TO_OWN_BUYOUT).toBe(aed("1000"));
    expect(result.contract.buyout).toBe(aed("1000"));
    expect(result.contract.totalRevenue).toBe(aed("127000"));
  });

  it("sets insurance charged against insurance paid", () => {
    const result = calculateDeal(
      deal({ annualInsuranceCharge: aed("2500"), annualInsuranceCost: aed("1800") }),
    );
    expect(result.contract.insuranceRevenue).toBe(aed("7500"));
    expect(result.contract.insuranceCost).toBe(aed("5400"));
    expect(result.contract.totalProfit).toBe(aed("41700"));
  });

  it("charges maintenance and one-off costs against the deal", () => {
    const result = calculateDeal(
      deal({ monthlyMaintenanceCost: aed("150"), otherCosts: aed("800") }),
    );
    expect(result.contract.maintenanceCost).toBe(aed("5400"));
    expect(result.contract.totalProfit).toBe(aed("33400"));
  });

  it("carries a company car's one-off cost for a lease-to-own that hands it over", () => {
    const result = calculateDeal(
      deal({
        ownership: "COMPANY_OWNED",
        vehicleMonthlyCost: undefined,
        vehicleOneOffCost: aed("95000"),
      }),
    );
    expect(result.contract.vehicleCost).toBe(aed("95000"));
    expect(result.contract.totalProfit).toBe(aed("31000"));
  });

  it("gives the margin in basis points", () => {
    // 39,600 profit on 126,000 revenue is 31.43%.
    expect(calculateDeal(deal()).contract.marginBasisPoints).toBe(3143);
  });
});

describe("edge cases the plan names", () => {
  it("reports a loss as a loss, never clamped to zero", () => {
    const result = calculateDeal(
      deal({ customerMonthlyRental: aed("2000"), vehicleMonthlyCost: aed("2400") }),
    );
    expect(result.monthly.grossProfit).toBe(aed("-400"));
    expect(result.contract.totalProfit).toBe(aed("-14400"));
    expect(result.contract.marginBasisPoints).toBe(-2000);
  });

  it("handles a vehicle that costs nothing", () => {
    const result = calculateDeal(
      deal({ ownership: "COMPANY_OWNED", dealType: "RENTAL", vehicleMonthlyCost: aed("0") }),
    );
    expect(result.contract.totalProfit).toBe(aed("126000"));
    expect(result.contract.marginBasisPoints).toBe(10_000);
  });

  it("handles a one-month term — the first year is that month", () => {
    const result = calculateDeal(deal({ durationMonths: 1, annualInsuranceCharge: aed("2500") }));
    expect(result.firstYear.months).toBe(1);
    expect(result.firstYear.rentalRevenue).toBe(aed("3500"));
    // The first of twelve largest-remainder shares of 2,500.
    expect(result.firstYear.insuranceRevenue).toBe(aed("208.34"));
  });

  it(`handles the longest term, ${MAX_DEAL_MONTHS} months`, () => {
    const result = calculateDeal(deal({ durationMonths: MAX_DEAL_MONTHS }));
    expect(result.contract.grossProfitFromRental).toBe(aed("132000"));
  });

  it("has no margin rather than a divide-by-zero when nothing is earned", () => {
    const result = calculateDeal(
      deal({ ownership: "COMPANY_OWNED", dealType: "RENTAL", customerMonthlyRental: aed("0") }),
    );
    expect(result.contract.marginBasisPoints).toBeNull();
  });
});

describe("annualOverMonths", () => {
  it("spreads a year exactly, however the year divides", () => {
    // 2,500 / 12 does not divide: naive monthly shares of 208.33 lose four fils a year.
    expect(annualOverMonths(aed("2500"), 12)).toBe(aed("2500"));
    expect(annualOverMonths(aed("2500"), 36)).toBe(aed("7500"));
  });

  it("covers a part year by exactly the months it has", () => {
    expect(annualOverMonths(aed("2500"), 13)).toBe(aed("2708.34"));
  });

  it("is nothing for nothing", () => {
    expect(annualOverMonths(aed("0"), 24)).toBe(0n);
  });
});

describe("validation", () => {
  // Labelled rather than printed with %j: JSON.stringify cannot serialise a bigint, and a
  // title that throws takes the whole file down before a single test runs.
  it.each([
    ["a zero-month term", { durationMonths: 0 }, "durationTooShort"],
    ["a term past the limit", { durationMonths: MAX_DEAL_MONTHS + 1 }, "durationTooLong"],
    ["a fractional term", { durationMonths: 12.5 }, "durationNotWholeNumber"],
    ["a negative rental", { customerMonthlyRental: aed("-1") }, "negativeAmount"],
    ["a negative one-off cost", { otherCosts: aed("-0.01") }, "negativeAmount"],
  ] as const)("refuses %s", (_label, overrides, code) => {
    expect(validateDealInput(deal(overrides)).map((issue) => issue.code)).toContain(code);
  });

  it("refuses a rental on a car leased from a supplier", () => {
    // The client's rule (2026-09-18), restated where the deal is priced.
    expect(
      validateDealInput(deal({ dealType: "RENTAL", ownership: "B2B_SUPPLIER" })).map((i) => i.code),
    ).toContain("rentalOnLeasedCar");
  });

  it("refuses a buyout on a rental", () => {
    expect(
      validateDealInput(
        deal({ dealType: "RENTAL", ownership: "COMPANY_OWNED", buyoutAmount: aed("1000") }),
      ).map((i) => i.code),
    ).toEqual(["buyoutOnRental"]);
  });

  it("reports every problem at once, so the form is fixed in one pass", () => {
    const issues = validateDealInput(
      deal({ durationMonths: 0, customerMonthlyRental: aed("-5"), dealType: "RENTAL" }),
    );
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });

  it("will not calculate an invalid deal", () => {
    expect(() => calculateDeal(deal({ durationMonths: 0 }))).toThrow(DealValidationError);
  });
});

/**
 * The plan's property: with only rent, vehicle cost and maintenance, total profit is
 * exactly the monthly margin times the term — for every valid input, not just the few
 * above. A seeded generator so a failure reproduces; no dependency just for this.
 */
describe("properties", () => {
  function* inputs(count: number): Generator<DealInput> {
    let seed = 20260918;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    for (let i = 0; i < count; i += 1) {
      yield {
        dealType: "LEASE_TO_OWN",
        ownership: "COMPANY_OWNED",
        durationMonths: 1 + (next() % MAX_DEAL_MONTHS),
        customerMonthlyRental: BigInt(next() % 2_000_000),
        vehicleMonthlyCost: BigInt(next() % 2_000_000),
        monthlyMaintenanceCost: BigInt(next() % 50_000),
      };
    }
  }

  it("total profit is the monthly margin times the term", () => {
    for (const input of inputs(500)) {
      const result = calculateDeal(input);
      const monthlyMargin =
        input.customerMonthlyRental - (input.vehicleMonthlyCost ?? 0n) - (input.monthlyMaintenanceCost ?? 0n);
      expect(result.contract.totalProfit).toBe(monthlyMargin * BigInt(input.durationMonths));
    }
  });

  it("revenue minus cost is always the profit, to the fil", () => {
    for (const input of inputs(500)) {
      const { contract } = calculateDeal({ ...input, annualInsuranceCharge: 250_000n, annualInsuranceCost: 180_000n });
      expect(contract.totalRevenue - contract.totalCost).toBe(contract.totalProfit);
    }
  });
});
