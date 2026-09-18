import { describe, expect, it } from "vitest";

import { addDays, addMonths, compareIsoDates, isIsoDate, parseIsoDate, periodMonthOf } from "./calendar";

describe("addMonths", () => {
  it("keeps the day of the month where the month has it", () => {
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-10", 24)).toBe("2028-01-10");
  });

  it("falls back to the last day where it does not", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-03-31", 1)).toBe("2026-04-30");
  });

  it("measures from the start, so the 31st comes back after a short month", () => {
    // Chained, the 28th would be carried forward and every later date would drift.
    expect(addMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonths("2026-01-31", 12)).toBe("2027-01-31");
  });

  it("handles 29 February in and out of leap years", () => {
    expect(addMonths("2028-02-29", 12)).toBe("2029-02-28");
    expect(addMonths("2028-02-29", 48)).toBe("2032-02-29");
  });

  it("goes backwards as well as forwards", () => {
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });
});

describe("addDays", () => {
  it("crosses month and year ends", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("parsing", () => {
  it.each(["2026-02-30", "2026-13-01", "2026-00-10", "26-01-01", "2026-1-1", ""])(
    "refuses %s",
    (value) => {
      expect(isIsoDate(value)).toBe(false);
      expect(() => parseIsoDate(value)).toThrow(RangeError);
    },
  );

  it("accepts a leap day only in a leap year", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
  });
});

describe("helpers", () => {
  it("orders dates", () => {
    expect(compareIsoDates("2026-01-31", "2026-02-01")).toBe(-1);
    expect(compareIsoDates("2026-02-01", "2026-02-01")).toBe(0);
  });

  it("gives the ledger's reporting period", () => {
    expect(periodMonthOf("2026-09-18")).toBe(202609);
  });
});
