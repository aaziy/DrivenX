/**
 * Payments against a schedule (P1D-06 – P1D-08, SOW §10).
 *
 * One payment can settle several instalments, and one instalment can be settled by several
 * payments. The allocation decides which: oldest first, because the oldest debt is the one
 * that is overdue and the one a customer expects a payment to clear.
 *
 * INV-2 and INV-3 live here: a payment's allocations sum to exactly the payment (anything
 * left is credit, not lost), and no instalment is ever paid past its amount.
 */

import { ZERO, type Fils } from "../money/money";
import { compareIsoDates, type IsoDate } from "./calendar";

export type InstallmentStatus =
  | "UPCOMING"
  | "DUE"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERDUE"
  | "WAIVED";

export interface InstallmentState {
  dueDate: IsoDate;
  grossFils: Fils;
  paidFils: Fils;
  waived: boolean;
}

/**
 * The status an instalment is in on a given day.
 *
 * Unpaid money past its due date is Overdue whether or not some of it has been paid — a
 * part-paid instalment that is late is late. Partially Paid is the state of one that has
 * been part-settled and is not yet due, or due today.
 */
export function installmentStatus(state: InstallmentState, today: IsoDate): InstallmentStatus {
  if (state.waived) return "WAIVED";
  if (state.paidFils >= state.grossFils) return "PAID";

  const comparison = compareIsoDates(state.dueDate, today);
  if (comparison < 0) return "OVERDUE";
  if (state.paidFils > ZERO) return "PARTIALLY_PAID";
  return comparison === 0 ? "DUE" : "UPCOMING";
}

export interface OpenInstallment {
  id: string;
  dueDate: IsoDate;
  sequence: number;
  grossFils: Fils;
  paidFils: Fils;
  waived: boolean;
}

export interface Allocation {
  installmentId: string;
  amountFils: Fils;
}

export interface AllocationResult {
  allocations: Allocation[];
  /** What was paid beyond everything owed — held as the customer's credit, never dropped. */
  creditFils: Fils;
}

export class InvalidPaymentError extends Error {
  constructor(readonly amountFils: Fils) {
    super(`A payment must be more than zero, not ${amountFils}`);
    this.name = "InvalidPaymentError";
  }
}

/**
 * Spread a payment across what is owed, oldest first.
 *
 * Waived and fully paid instalments take nothing. What cannot be placed is returned as
 * credit — a customer who pays AED 5,000 against AED 3,570 owed has AED 1,430 on account,
 * and the allocations plus the credit are always exactly the payment.
 */
export function allocatePayment(
  amountFils: Fils,
  installments: readonly OpenInstallment[],
): AllocationResult {
  if (amountFils <= ZERO) throw new InvalidPaymentError(amountFils);

  const owed = installments
    .filter((item) => !item.waived && item.paidFils < item.grossFils)
    .sort(
      (a, b) =>
        compareIsoDates(a.dueDate, b.dueDate) || a.sequence - b.sequence || (a.id < b.id ? -1 : 1),
    );

  let remaining = amountFils;
  const allocations: Allocation[] = [];

  for (const item of owed) {
    if (remaining === ZERO) break;
    const outstanding = item.grossFils - item.paidFils;
    const applied = remaining < outstanding ? remaining : outstanding;
    allocations.push({ installmentId: item.id, amountFils: applied });
    remaining -= applied;
  }

  return { allocations, creditFils: remaining };
}

/** What is still owed across a set of instalments, waived ones excluded. */
export function outstandingFils(installments: readonly OpenInstallment[]): Fils {
  let total = ZERO;
  for (const item of installments) {
    if (!item.waived && item.paidFils < item.grossFils) total += item.grossFils - item.paidFils;
  }
  return total;
}
