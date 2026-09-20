import { describe, expect, it } from "vitest";

import { parse } from "../money/money";
import { calculateDeal } from "../pricing/deal";
import { addDays } from "./calendar";
import {
  buildSchedule,
  chargesFor,
  contractEndDate,
  expandCharge,
  scheduleTotals,
  vatOn,
  type ContractTerms,
  netFromGross,
} from "./schedule";

const aed = (value: string) => parse(value);

function terms(overrides: Partial<ContractTerms> = {}): ContractTerms {
  return {
    startDate: "2026-01-01",
    durationMonths: 36,
    monthlyRental: aed("3400"),
    ...overrides,
  };
}

const count = (items: { chargeType: string }[], type: string) =>
  items.filter((item) => item.chargeType === type).length;

describe("the milestone's exit criterion", () => {
  it("a 36-month contract with annual insurance is 36 rental and 3 insurance instalments", () => {
    const schedule = buildSchedule(terms({ annualInsurance: aed("2500") }));

    expect(count(schedule, "MONTHLY_RENTAL")).toBe(36);
    expect(count(schedule, "ANNUAL_INSURANCE")).toBe(3);
    expect(schedule).toHaveLength(39);
  });

  it("and the schedule is worth exactly the contract, to the fil (INV-1)", () => {
    const schedule = buildSchedule(
      terms({ annualInsurance: aed("2500"), downPayment: aed("5000"), buyout: aed("1000") }),
    );
    // 3,400 × 36 + 2,500 × 3 + 5,000 + 1,000
    expect(scheduleTotals(schedule).netFils).toBe(aed("135900"));
  });
});

describe("charge expansion across terms", () => {
  it.each([
    [12, 1],
    [24, 2],
    [36, 3],
    [60, 5],
  ])("%i months: that many rentals and %i insurance instalments", (months, insurance) => {
    const schedule = buildSchedule(terms({ durationMonths: months, annualInsurance: aed("2500") }));
    expect(count(schedule, "MONTHLY_RENTAL")).toBe(months);
    expect(count(schedule, "ANNUAL_INSURANCE")).toBe(insurance);
  });

  it("charges a final part year of insurance for exactly the months it covers", () => {
    // 30 months: two full years, then six months. Largest remainder splits 2,500 into
    // four shares of 208.34 and eight of 208.33, so six months is 4 × 208.34 + 2 × 208.33.
    const insurance = buildSchedule(terms({ durationMonths: 30, annualInsurance: aed("2500") })).filter(
      (item) => item.chargeType === "ANNUAL_INSURANCE",
    );

    expect(insurance.map((item) => item.netFils)).toEqual([aed("2500"), aed("2500"), aed("1250.02")]);
  });

  it("leaves out charges that are zero or absent", () => {
    const types = chargesFor(terms({ downPayment: aed("0") })).map((charge) => charge.chargeType);
    expect(types).toEqual(["MONTHLY_RENTAL"]);
  });
});

describe("dates", () => {
  it("keeps a contract starting on the 31st on the 31st where the month allows", () => {
    const rentals = buildSchedule(terms({ startDate: "2026-01-31", durationMonths: 4 }));
    expect(rentals.map((item) => item.dueDate)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("lays the periods end to end with no gap and no overlap", () => {
    for (const startDate of ["2026-01-31", "2028-02-29", "2026-03-15"]) {
      const rentals = buildSchedule(terms({ startDate, durationMonths: 24 }));
      for (let i = 1; i < rentals.length; i += 1) {
        expect(rentals[i]!.periodStart, `${startDate} #${i}`).toBe(addDays(rentals[i - 1]!.periodEnd, 1));
      }
      expect(rentals.at(-1)!.periodEnd).toBe(contractEndDate(startDate, 24));
    }
  });

  it("handles a contract starting on 29 February", () => {
    const insurance = buildSchedule(
      terms({ startDate: "2028-02-29", durationMonths: 24, annualInsurance: aed("2500") }),
    ).filter((item) => item.chargeType === "ANNUAL_INSURANCE");
    expect(insurance.map((item) => item.dueDate)).toEqual(["2028-02-29", "2029-02-28"]);
  });

  it("ends the day before the month after the last period begins", () => {
    expect(contractEndDate("2026-01-01", 36)).toBe("2028-12-31");
    expect(contractEndDate("2026-01-15", 12)).toBe("2027-01-14");
  });

  it("takes the down payment on the first day and the buyout on the last", () => {
    const schedule = buildSchedule(terms({ downPayment: aed("5000"), buyout: aed("1000") }));
    expect(schedule[0]).toMatchObject({ chargeType: "DOWN_PAYMENT", dueDate: "2026-01-01" });
    expect(schedule.at(-1)).toMatchObject({ chargeType: "BUYOUT", dueDate: "2028-12-31" });
  });
});

describe("VAT on each instalment (INV-10)", () => {
  it("adds 5% on top of the net amount", () => {
    const [first] = buildSchedule(terms());
    expect(first).toMatchObject({ netFils: aed("3400"), vatFils: aed("170"), grossFils: aed("3570") });
    expect(first!.vatBasisPoints).toBe(500);
  });

  it("rounds VAT once, half up, where it is invoiced", () => {
    // 208.34 × 5% is 10.417.
    expect(vatOn(aed("208.34"), 500)).toBe(aed("10.42"));
  });

  it("keeps gross equal to net plus VAT on every instalment", () => {
    const schedule = buildSchedule(
      terms({ durationMonths: 30, annualInsurance: aed("2500"), buyout: aed("1000") }),
    );
    for (const item of schedule) {
      expect(item.grossFils).toBe(item.netFils + item.vatFils);
      expect(item.vatFils).toBe(vatOn(item.netFils, item.vatBasisPoints));
    }
  });

  it("carries a different rate if a contract is written with one", () => {
    const [first] = buildSchedule(terms({ vatBasisPoints: 0 }));
    expect(first!.grossFils).toBe(aed("3400"));
  });
});

describe("the quote and the contract agree", () => {
  it("schedules exactly the revenue the deal calculator promised, for every term", () => {
    // The deal calculator (1C) and the schedule (1D) are separate code paths. If they
    // ever disagree, a customer is quoted one figure and billed another.
    for (let months = 1; months <= 120; months += 1) {
      const inputs = {
        rental: aed("3400"),
        insurance: aed("2500"),
        down: aed("5000"),
        buyout: aed("1000"),
      };
      const schedule = buildSchedule(
        terms({
          durationMonths: months,
          monthlyRental: inputs.rental,
          annualInsurance: inputs.insurance,
          downPayment: inputs.down,
          buyout: inputs.buyout,
        }),
      );
      const quote = calculateDeal({
        dealType: "LEASE_TO_OWN",
        ownership: "COMPANY_OWNED",
        durationMonths: months,
        customerMonthlyRental: inputs.rental,
        annualInsuranceCharge: inputs.insurance,
        downPayment: inputs.down,
        buyoutAmount: inputs.buyout,
      });

      expect(scheduleTotals(schedule).netFils, `${months} months`).toBe(quote.contract.totalRevenue);
    }
  });
});

describe("expandCharge", () => {
  it("expands a one-off charge to a single instalment on its day", () => {
    const [only, ...rest] = expandCharge(
      {
        key: "fee",
        chargeType: "ADMIN_FEE",
        label: "Admin fee",
        recurrence: "ONCE",
        amount: aed("250"),
        startsOn: "2026-02-10",
        occurrences: 1,
        vatBasisPoints: 500,
      },
      12,
    );
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ dueDate: "2026-02-10", netFils: aed("250"), grossFils: aed("262.50") });
  });
});

describe("netFromGross", () => {
  it("works a VAT-inclusive amount back to its net share", () => {
    expect(netFromGross(parse("2100"), 500)).toBe(parse("2000"));
    expect(netFromGross(parse("3570"), 500)).toBe(parse("3400"));
    expect(netFromGross(0n, 500)).toBe(0n);
  });

  it("round-trips: net plus its VAT is the gross it came from", () => {
    for (const gross of ["0.05", "1", "999.99", "12345.67"]) {
      const amount = parse(gross);
      const net = netFromGross(amount, 500);
      expect(net + vatOn(net, 500)).toBe(amount);
    }
  });
});
