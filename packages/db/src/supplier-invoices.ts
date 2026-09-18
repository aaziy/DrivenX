/**
 * Supplier payables for leased-in cars (P1D-13).
 *
 * The schedule is written when a lease-to-own contract on a leased-in car is activated,
 * one invoice per contract month. The cost is recognised when each falls due, in the month
 * it belongs to — the mirror of revenue on the customer side — so a car's profit for a
 * month is that month's rental less that month's lease. Paying the supplier is cash moving,
 * not cost, and never reaches the ledger.
 */

import {
  assertSupplierPayment,
  InvalidPaymentError,
  supplierInvoiceStatus,
  supplierSchedule,
  SupplierOverpaymentError,
  type IsoDate,
} from "@drivenx/core";

import type { PaymentMethod } from "../generated/client";
import type { Tx } from "./tx";
import { fromDbDate, toDbDate } from "./dates";
import { prisma } from "./index";
import { postToLedger } from "./ledger";

export type SupplierInvoiceRuleCode = "invoiceNotFound" | "invalidPayment" | "overpayment" | "paymentInFuture";

export class SupplierInvoiceRuleError extends Error {
  constructor(readonly code: SupplierInvoiceRuleCode) {
    super(`Supplier invoice refused: ${code}`);
    this.name = "SupplierInvoiceRuleError";
  }
}

/** Write a contract's payable schedule. Called inside activation, under its lock. */
export async function writeSupplierSchedule(
  tx: Tx,
  contract: { id: string; vehicleId: string; supplierId: string; startDate: IsoDate; durationMonths: number },
  monthlyCostFils: bigint,
): Promise<number> {
  const schedule = supplierSchedule(contract.startDate, contract.durationMonths, monthlyCostFils);
  await tx.supplierInvoice.createMany({
    data: schedule.map((item) => ({
      supplierId: contract.supplierId,
      vehicleId: contract.vehicleId,
      contractId: contract.id,
      sequence: item.sequence,
      periodStart: toDbDate(item.periodStart),
      periodEnd: toDbDate(item.periodEnd),
      dueDate: toDbDate(item.dueDate),
      amountFils: item.amountFils,
    })),
  });
  return schedule.length;
}

/**
 * Raise a contract's supplier invoices that have fallen due: mark them raised and post the
 * cost. The raised-on guard and the ledger's uniqueness each make a second run a no-op.
 */
export async function raiseDueSupplierInvoicesForContract(
  tx: Tx,
  contractId: string,
  today: IsoDate,
): Promise<number> {
  const due = await tx.supplierInvoice.findMany({
    where: { contractId, raisedOn: null, dueDate: { lte: toDbDate(today) } },
    orderBy: { sequence: "asc" },
    include: { contract: { select: { number: true, customerId: true } } },
  });

  for (const invoice of due) {
    const dueDate = fromDbDate(invoice.dueDate);
    const claimed = await tx.supplierInvoice.updateMany({
      where: { id: invoice.id, raisedOn: null },
      data: {
        raisedOn: toDbDate(today),
        status: supplierInvoiceStatus({ amountFils: invoice.amountFils, paidFils: invoice.paidFils, dueDate }, today),
      },
    });
    if (claimed.count === 0) throw new Error(`Supplier invoice ${invoice.id} was raised concurrently`);

    await postToLedger(tx, {
      occurredOn: dueDate,
      direction: "COST",
      category: "cost.supplier",
      amountFils: invoice.amountFils,
      vehicleId: invoice.vehicleId,
      contractId: invoice.contractId,
      customerId: invoice.contract.customerId,
      supplierId: invoice.supplierId,
      sourceType: "SupplierInvoice",
      sourceId: invoice.id,
      memo: invoice.contract.number,
    });
  }
  return due.length;
}

/** The nightly pass: raise what fell due on every live contract. */
export async function raiseDueSupplierInvoices(today: IsoDate): Promise<{ contracts: number; raised: number }> {
  const contracts = await prisma.contract.findMany({
    where: {
      status: { in: ["ACTIVE", "OVERDUE"] },
      deletedAt: null,
      supplierInvoices: { some: { raisedOn: null, dueDate: { lte: toDbDate(today) } } },
    },
    select: { id: true },
  });

  let raised = 0;
  for (const contract of contracts) {
    raised += await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contract.id} FOR UPDATE`;
        return raiseDueSupplierInvoicesForContract(tx, contract.id, today);
      },
      { timeout: 30_000 },
    );
  }
  return { contracts: contracts.length, raised };
}

/** Raised invoices past their due date and not fully paid become Overdue. */
export async function refreshSupplierOverdue(today: IsoDate): Promise<number> {
  const { count } = await prisma.supplierInvoice.updateMany({
    where: {
      raisedOn: { not: null },
      dueDate: { lt: toDbDate(today) },
      status: { in: ["UPCOMING", "DUE", "PARTIALLY_PAID"] },
    },
    data: { status: "OVERDUE" },
  });
  return count;
}

export interface NewSupplierPayment {
  amountFils: bigint;
  paidOn: IsoDate;
  method: PaymentMethod;
  reference?: string | null;
}

/**
 * Record a payment to a supplier against one invoice.
 *
 * An invoice not yet due can be paid ahead; one cannot be paid past what it bills. A date
 * in the future is refused, as it is for customer payments.
 */
export async function recordSupplierPayment(
  invoiceId: string,
  payment: NewSupplierPayment,
  options: { actorId: string | null; today: IsoDate },
) {
  if (payment.paidOn > options.today) throw new SupplierInvoiceRuleError("paymentInFuture");

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM supplier_invoices WHERE id = ${invoiceId} FOR UPDATE`;
    const invoice = await tx.supplierInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new SupplierInvoiceRuleError("invoiceNotFound");

    try {
      assertSupplierPayment(payment.amountFils, invoice.amountFils - invoice.paidFils);
    } catch (error) {
      if (error instanceof SupplierOverpaymentError) throw new SupplierInvoiceRuleError("overpayment");
      if (error instanceof InvalidPaymentError) throw new SupplierInvoiceRuleError("invalidPayment");
      throw error;
    }

    const created = await tx.supplierPayment.create({
      data: {
        supplierInvoiceId: invoice.id,
        supplierId: invoice.supplierId,
        paidOn: toDbDate(payment.paidOn),
        amountFils: payment.amountFils,
        method: payment.method,
        reference: payment.reference?.trim() || null,
        recordedById: options.actorId,
      },
    });

    const paidFils = invoice.paidFils + payment.amountFils;
    await tx.supplierInvoice.update({
      where: { id: invoice.id },
      data: {
        paidFils,
        status: supplierInvoiceStatus(
          { amountFils: invoice.amountFils, paidFils, dueDate: fromDbDate(invoice.dueDate) },
          options.today,
        ),
      },
    });
    return created;
  });
}

/** Note the supplier's own invoice number once their paper arrives. */
export async function setSupplierReference(invoiceId: string, reference: string | null): Promise<void> {
  const { count } = await prisma.supplierInvoice.updateMany({
    where: { id: invoiceId },
    data: { supplierReference: reference?.trim() || null },
  });
  if (count === 0) throw new SupplierInvoiceRuleError("invoiceNotFound");
}
