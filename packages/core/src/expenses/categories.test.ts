import { describe, expect, it } from "vitest";

import {
  allocationDimensions,
  defaultVatBasisPoints,
  EXPENSE_ALLOCATIONS,
  EXPENSE_CATEGORIES,
  expenseLedgerCategory,
} from "./categories";

describe("where an expense lands in the ledger", () => {
  it("gives every category its own category, derived from its name", () => {
    expect(expenseLedgerCategory("REGISTRATION")).toBe("cost.registration");
    expect(expenseLedgerCategory("FUEL")).toBe("cost.fuel");
    expect(expenseLedgerCategory("OVERHEAD")).toBe("cost.overhead");
  });

  it("gives no two categories the same ledger category", () => {
    const posted = EXPENSE_CATEGORIES.map(expenseLedgerCategory);
    expect(new Set(posted).size).toBe(posted.length);
  });

  it("always posts a cost, never a revenue", () => {
    for (const category of EXPENSE_CATEGORIES) {
      expect(expenseLedgerCategory(category).startsWith("cost.")).toBe(true);
    }
  });
});

describe("VAT on an expense", () => {
  it("assumes none on a government charge, which is not a supply", () => {
    // Nothing to reclaim, so assuming 5% would understate what these actually cost.
    expect(defaultVatBasisPoints("REGISTRATION")).toBe(0);
    expect(defaultVatBasisPoints("TOLL")).toBe(0);
    expect(defaultVatBasisPoints("PARKING")).toBe(0);
  });

  it("assumes the standard rate on an ordinary supply", () => {
    expect(defaultVatBasisPoints("FUEL")).toBe(500);
    expect(defaultVatBasisPoints("CLEANING")).toBe(500);
    expect(defaultVatBasisPoints("RECOVERY")).toBe(500);
    expect(defaultVatBasisPoints("OVERHEAD")).toBe(500);
  });
});

describe("what an allocation needs", () => {
  it("asks for a car only when the cost is charged to one", () => {
    expect(allocationDimensions("VEHICLE")).toEqual({ needsVehicle: true, needsContract: false });
    expect(allocationDimensions("CONTRACT")).toEqual({ needsVehicle: false, needsContract: true });
  });

  it("asks for nothing when the cost belongs to the company", () => {
    expect(allocationDimensions("COMPANY")).toEqual({ needsVehicle: false, needsContract: false });
  });

  it("covers every allocation", () => {
    expect(EXPENSE_ALLOCATIONS).toHaveLength(3);
  });
});
