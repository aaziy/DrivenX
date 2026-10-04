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

  it("keys labels by side, so money in and money out are never named alike", () => {
    expect(categoryLabelKey("revenue.insurance")).toBe("revenue.insurance");
    expect(categoryLabelKey("cost.insurance")).toBe("cost.insurance");
  });

  it("gives every category a label key of its own", () => {
    // Two categories under one key print with one label. That is how the premium DrivenX
    // pays its insurer came to be shown as insurance charged to customers.
    const keys = LEDGER_CATEGORIES.map(categoryLabelKey);
    expect(new Set(keys).size).toBe(keys.length);
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
