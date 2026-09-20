/**
 * Statements of account (P1E-07, P1E-08).
 *
 * A customer's statement is what they were invoiced against what they paid, in date
 * order, with a running balance. An instalment enters when it is invoiced — dated on its
 * due date, which is when it is issued — not when it is scheduled: a statement lists
 * invoices, and a future month is not one yet. A waiver of an invoiced instalment is a
 * credit on the day it was waived. A payment is a credit on the day it was received, all
 * of it, including anything held as credit — so a customer who paid ahead shows a
 * balance in their favour, which is what they are.
 *
 * A supplier's statement is the same from the other side: what they billed DrivenX,
 * raised as each month fell due, against what DrivenX paid them.
 *
 * The balance before the range is carried in as the opening line, so a statement for any
 * range closes on the same figure as one for all time.
 */

import { businessDate, type IsoDate } from "@drivenx/core";

import { fromDbDate, toDbDate } from "./dates";
import { prisma } from "./index";

export type StatementLineKind = "invoice" | "payment" | "waiver";

export interface StatementLine {
  date: IsoDate;
  kind: StatementLineKind;
  /** Invoice number, payment reference, or the contract number. */
  reference: string | null;
  contractNumber: string | null;
  contractId: string | null;
  /** What raised the balance: an invoice. */
  debitFils: bigint;
  /** What lowered it: a payment or a waiver. */
  creditFils: bigint;
  balanceFils: bigint;
}

export interface Statement {
  from: IsoDate;
  to: IsoDate;
  openingFils: bigint;
  lines: StatementLine[];
  debitsFils: bigint;
  creditsFils: bigint;
  closingFils: bigint;
}

type Movement = Omit<StatementLine, "balanceFils">;

/** Order a day's movements: invoices before what settles them. */
const KIND_ORDER: Record<StatementLineKind, number> = { invoice: 0, waiver: 1, payment: 2 };

function build(from: IsoDate, to: IsoDate, movements: Movement[]): Statement {
  movements.sort(
    (a, b) =>
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.reference ?? "").localeCompare(b.reference ?? ""),
  );

  let openingFils = 0n;
  const lines: StatementLine[] = [];
  let balance = 0n;
  let debitsFils = 0n;
  let creditsFils = 0n;

  for (const movement of movements) {
    const net = movement.debitFils - movement.creditFils;
    if (movement.date < from) {
      openingFils += net;
      continue;
    }
    if (movement.date > to) continue;
    if (lines.length === 0) balance = openingFils;
    balance += net;
    debitsFils += movement.debitFils;
    creditsFils += movement.creditFils;
    lines.push({ ...movement, balanceFils: balance });
  }

  return { from, to, openingFils, lines, debitsFils, creditsFils, closingFils: openingFils + debitsFils - creditsFils };
}

export async function customerStatement(customerId: string, from: IsoDate, to: IsoDate): Promise<Statement> {
  // Everything up to the end of the range: what came before makes the opening balance.
  const until = toDbDate(to);
  const [installments, payments] = await Promise.all([
    prisma.installment.findMany({
      where: { contract: { customerId, deletedAt: null }, invoiceNumber: { not: null }, dueDate: { lte: until } },
      select: {
        invoiceNumber: true,
        dueDate: true,
        grossFils: true,
        waivedAt: true,
        contract: { select: { id: true, number: true } },
      },
    }),
    prisma.payment.findMany({
      where: { customerId, contract: { deletedAt: null }, receivedOn: { lte: until } },
      select: { receivedOn: true, amountFils: true, reference: true, contract: { select: { id: true, number: true } } },
    }),
  ]);

  const movements: Movement[] = [];
  for (const item of installments) {
    movements.push({
      date: fromDbDate(item.dueDate),
      kind: "invoice",
      reference: item.invoiceNumber,
      contractNumber: item.contract.number,
      contractId: item.contract.id,
      debitFils: item.grossFils,
      creditFils: 0n,
    });
    // Waiving is only allowed on an unpaid instalment, so the whole invoice comes back.
    if (item.waivedAt) {
      movements.push({
        date: businessDate(item.waivedAt),
        kind: "waiver",
        reference: item.invoiceNumber,
        contractNumber: item.contract.number,
        contractId: item.contract.id,
        debitFils: 0n,
        creditFils: item.grossFils,
      });
    }
  }
  for (const payment of payments) {
    movements.push({
      date: fromDbDate(payment.receivedOn),
      kind: "payment",
      reference: payment.reference,
      contractNumber: payment.contract.number,
      contractId: payment.contract.id,
      debitFils: 0n,
      creditFils: payment.amountFils,
    });
  }
  return build(from, to, movements);
}

export async function supplierStatement(supplierId: string, from: IsoDate, to: IsoDate): Promise<Statement> {
  const until = toDbDate(to);
  const [invoices, payments] = await Promise.all([
    prisma.supplierInvoice.findMany({
      where: { supplierId, raisedOn: { not: null }, dueDate: { lte: until } },
      select: {
        dueDate: true,
        grossFils: true,
        supplierReference: true,
        contract: { select: { id: true, number: true } },
      },
    }),
    prisma.supplierPayment.findMany({
      where: { supplierId, paidOn: { lte: until } },
      select: {
        paidOn: true,
        amountFils: true,
        reference: true,
        supplierInvoice: { select: { contract: { select: { id: true, number: true } } } },
      },
    }),
  ]);

  const movements: Movement[] = [
    ...invoices.map((invoice) => ({
      date: fromDbDate(invoice.dueDate),
      kind: "invoice" as const,
      reference: invoice.supplierReference,
      contractNumber: invoice.contract.number,
      contractId: invoice.contract.id,
      // What the supplier billed, VAT included: a statement is what is owed, not cost.
      debitFils: invoice.grossFils,
      creditFils: 0n,
    })),
    ...payments.map((payment) => ({
      date: fromDbDate(payment.paidOn),
      kind: "payment" as const,
      reference: payment.reference,
      contractNumber: payment.supplierInvoice.contract.number,
      contractId: payment.supplierInvoice.contract.id,
      debitFils: 0n,
      creditFils: payment.amountFils,
    })),
  ];
  return build(from, to, movements);
}
