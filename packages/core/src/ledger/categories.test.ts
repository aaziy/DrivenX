import { describe, expect, it } from "vitest";

import {
  categoryLabelKey,
  COST_CATEGORIES,
  isCostCategory,
  isKnownCategory,
  isRevenueCategory,
  LEDGER_CATEGORIES,
  REVENUE_CATEGORIES,
} from "./categories";

describe("the ledger's categories", () => {
  it("names each one once", () => {
    expect(new Set(LEDGER_CATEGORIES).size).toBe(LEDGER_CATEGORIES.length);
  });

  it("puts every category on one side of the ledger or the other", () => {
    for (const category of REVENUE_CATEGORIES) {
      expect(isRevenueCategory(category), category).toBe(true);
      expect(isCostCategory(category), category).toBe(false);
    }
    for (const category of COST_CATEGORIES) {
      expect(isCostCategory(category), category).toBe(true);
      expect(isRevenueCategory(category), category).toBe(false);
    }
  });

  it("recognises what belongs and what does not", () => {
    expect(isKnownCategory("cost.maintenance")).toBe(true);
    expect(isKnownCategory("cost.maintainance")).toBe(false);
    expect(isKnownCategory("revenue.rentl")).toBe(false);
  });

  it("takes the label key from the part after the dot", () => {
    expect(categoryLabelKey("cost.fine_recovery")).toBe("fine_recovery");
    expect(categoryLabelKey("revenue.rental")).toBe("rental");
  });

  it("covers everything §3.2 named plus what Phase 2 added", () => {
    // The two sides the SOW's reporting rests on.
    expect(REVENUE_CATEGORIES).toContain("revenue.rental");
    expect(REVENUE_CATEGORIES).toContain("revenue.insurance");
    expect(COST_CATEGORIES).toContain("cost.supplier");
    // Phase 2's own.
    for (const category of ["cost.maintenance", "cost.repair", "cost.fine", "cost.overhead"]) {
      expect(COST_CATEGORIES).toContain(category);
    }
    expect(REVENUE_CATEGORIES).toContain("revenue.insurance_claim");
  });
});
