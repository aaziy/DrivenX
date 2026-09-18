/**
 * What DrivenX owes the supplier of a leased-in car (P1D-13).
 *
 * A leased-in car only ever goes out on lease-to-own (§8 row 14), so the payable is tied to
 * that contract: one invoice per contract month, over the same periods as the customer's
 * rental, at the monthly cost agreed with the supplier. It is the customer schedule's
 * mirror image — money going out where the instalments bring it in.
 *
 * The amount is the vehicle's supplier monthly cost as entered. Whether the 5% the supplier
 * charges is recoverable (open question 12) decides whether that figure should be net or
 * gross; nothing here assumes either.
 */
import type { Fils } from "../money/money";
import { addDays, addMonths, type IsoDate } from "./calendar";
import { installmentStatus, InvalidPaymentError, type InstallmentStatus } from "./payments";

export interface ScheduledSupplierInvoice {
  sequence: number;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  /** The first day of the period it pays for, the same day the customer's rental falls due. */
  dueDate: IsoDate;
  amountFils: Fils;
}

export function supplierSchedule(
  startDate: IsoDate,
  durationMonths: number,
  monthlyCostFils: Fils,
): ScheduledSupplierInvoice[] {
  if (!Number.isInteger(durationMonths) || durationMonths < 1) {
    throw new RangeError(`A supplier schedule needs at least one month, not ${durationMonths}.`);
  }
  if (monthlyCostFils <= 0n) {
    throw new RangeError("A supplier schedule needs a monthly cost above zero.");
  }

  return Array.from({ length: durationMonths }, (_, index) => ({
    sequence: index + 1,
    periodStart: addMonths(startDate, index),
    periodEnd: addDays(addMonths(startDate, index + 1), -1),
    dueDate: addMonths(startDate, index),
    amountFils: monthlyCostFils,
  }));
}

export type SupplierInvoiceStatus = Exclude<InstallmentStatus, "WAIVED">;

export function supplierInvoiceStatus(
  state: { amountFils: Fils; paidFils: Fils; dueDate: IsoDate },
  today: IsoDate,
): SupplierInvoiceStatus {
  // Same rule as a customer instalment, seen from the other side; nothing is waived here.
  return installmentStatus(
    { grossFils: state.amountFils, paidFils: state.paidFils, dueDate: state.dueDate, waived: false },
    today,
  ) as SupplierInvoiceStatus;
}

/**
 * A payment to a supplier settles one invoice and cannot exceed what is left on it.
 *
 * A customer overpayment becomes credit because the money is already in hand; paying a
 * supplier more than they billed is a mistake to stop at the keyboard, not a balance to
 * carry.
 */
export class SupplierOverpaymentError extends Error {
  constructor(
    readonly amountFils: Fils,
    readonly outstandingFils: Fils,
  ) {
    super(`A supplier payment of ${amountFils} is more than the ${outstandingFils} left on the invoice`);
    this.name = "SupplierOverpaymentError";
  }
}

export function assertSupplierPayment(amountFils: Fils, outstandingFils: Fils): void {
  if (amountFils <= 0n) throw new InvalidPaymentError(amountFils);
  if (amountFils > outstandingFils) throw new SupplierOverpaymentError(amountFils, outstandingFils);
}
