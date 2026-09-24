/**
 * Expenses, and where each one lands in the ledger (P2-11, SOW §13).
 *
 * Every cost DrivenX carries that is not a supplier's monthly bill, a service, a fine or
 * a crash: registration, fuel, tolls, cleaning, recovery, and the office costs that
 * belong to no car at all.
 *
 * Each category is its own ledger category rather than all of them landing in
 * `cost.other`. PROJECT_PLAN.md §3.2 promised that extending the system means adding
 * ledger categories rather than migrating the core, and this is that promise being spent:
 * the profit reports already sum whatever they find, so a new category needs no change to
 * them, while "what did registration cost us last year" stays a question the ledger can
 * answer on its own.
 */

export const EXPENSE_CATEGORIES = [
  /** Mulkiya renewal, testing, plate fees. */
  "REGISTRATION",
  "FUEL",
  /** Salik and road tolls. */
  "TOLL",
  "CLEANING",
  "PARKING",
  /** Towing and roadside recovery. */
  "RECOVERY",
  /** The office, software, salaries: real costs that belong to no one car. */
  "OVERHEAD",
  "OTHER",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Where an expense is charged. */
export const EXPENSE_ALLOCATIONS = ["VEHICLE", "CONTRACT", "COMPANY"] as const;

export type ExpenseAllocation = (typeof EXPENSE_ALLOCATIONS)[number];

/**
 * The ledger category for an expense category: `cost.` and the name, lowercased.
 *
 * Derived rather than mapped by hand, so a category added to the list above cannot be
 * forgotten here and quietly post to the wrong place.
 */
export function expenseLedgerCategory(category: ExpenseCategory): string {
  return `cost.${category.toLowerCase()}`;
}

/**
 * Whether a category is normally outside VAT.
 *
 * Government charges — registration, Salik, public parking — are not a supply by a
 * taxable person, so there is no input VAT on them to reclaim. Getting this wrong
 * understates the cost by the VAT it wrongly assumes is coming back, on exactly the
 * expenses DrivenX incurs most often. It is a default the form offers, not a rule: a
 * private car park does charge VAT, and staff can say so.
 */
export function defaultVatBasisPoints(category: ExpenseCategory): number {
  return category === "REGISTRATION" || category === "TOLL" || category === "PARKING" ? 0 : 500;
}

/** A company-wide cost belongs to no car and no contract. */
export function allocationDimensions(allocation: ExpenseAllocation): {
  needsVehicle: boolean;
  needsContract: boolean;
} {
  return {
    needsVehicle: allocation === "VEHICLE",
    needsContract: allocation === "CONTRACT",
  };
}
