/**
 * Every category the ledger posts to (P2-13, PROJECT_PLAN.md §3.2).
 *
 * The ledger's `category` is a string rather than an enum on purpose: §3.2 promised that
 * extending this system means adding a category, not migrating the core, and a database
 * enum would have made every addition a migration and a deployment.
 *
 * The cost of that freedom is that nothing stops a typo, so this is the list of the ones
 * that are meant to exist. It is what the reports iterate and what the label catalogues
 * are checked against, so a category added without a name cannot reach a screen as a raw
 * key — which is exactly how a charge type shipped unlabelled earlier in this phase.
 */

export const REVENUE_CATEGORIES = [
  "revenue.rental",
  "revenue.insurance",
  "revenue.excess_mileage",
  "revenue.fine_recovery",
  "revenue.insurance_claim",
  "revenue.salvage",
  "revenue.other",
] as const;

export const COST_CATEGORIES = [
  "cost.supplier",
  "cost.insurance",
  "cost.maintenance",
  "cost.repair",
  "cost.registration",
  "cost.fine",
  "cost.fuel",
  "cost.toll",
  "cost.cleaning",
  "cost.parking",
  "cost.recovery",
  "cost.overhead",
  "cost.other",
] as const;

export const LEDGER_CATEGORIES = [...REVENUE_CATEGORIES, ...COST_CATEGORIES] as const;

export type RevenueCategory = (typeof REVENUE_CATEGORIES)[number];
export type CostCategory = (typeof COST_CATEGORIES)[number];
export type LedgerCategory = RevenueCategory | CostCategory;

export function isRevenueCategory(category: string): category is RevenueCategory {
  return category.startsWith("revenue.");
}

export function isCostCategory(category: string): category is CostCategory {
  return category.startsWith("cost.");
}

export function isKnownCategory(category: string): category is LedgerCategory {
  return (LEDGER_CATEGORIES as readonly string[]).includes(category);
}

/**
 * The key a label catalogue holds this category under: the part after the dot.
 *
 * Split that way so the two halves of a category — what it is, and whether it is money
 * in or money out — stay separate in the interface as they are in the ledger.
 */
export function categoryLabelKey(category: string): string {
  return category.slice(category.indexOf(".") + 1);
}
