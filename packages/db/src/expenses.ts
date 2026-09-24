/**
 * Expenses (P2-11, SOW §13).
 *
 * Everything DrivenX pays for that is not a supplier's monthly bill, a service, a fine or
 * a crash — and, importantly, the costs that belong to no car at all.
 *
 * The allocation is the whole design. A cost charged to a car reaches that car's
 * profitability; a cost charged to a contract reaches the customer's too; a company-wide
 * cost carries no dimensions and so reaches the month without being smeared across
 * vehicles that did not incur it. The database enforces that, because an overhead filed
 * against a car is invisible once it is in the ledger and would quietly distort every
 * per-vehicle figure from then on.
 */

import {
  allocationDimensions,
  defaultVatBasisPoints,
  expenseLedgerCategory,
  vatOn,
  type ExpenseAllocation,
  type ExpenseCategory,
  type IsoDate,
} from "@drivenx/core";

import { toDbDate } from "./dates";
import { prisma } from "./index";
import { postToLedger } from "./ledger";

export type ExpenseRuleCode =
  | "invalidExpense"
  | "vehicleRequired"
  | "contractRequired"
  | "vehicleNotFound"
  | "contractNotFound"
  | "expenseNotFound";

export class ExpenseRuleError extends Error {
  constructor(readonly code: ExpenseRuleCode) {
    super(`Expense refused: ${code}`);
    this.name = "ExpenseRuleError";
  }
}

export interface NewExpense {
  category: ExpenseCategory;
  allocation: ExpenseAllocation;
  /** Required when charging a car. */
  vehicleId?: string | null;
  /** Required when charging a contract. */
  contractId?: string | null;
  incurredOn: IsoDate;
  description: string;
  supplierName?: string | null;
  referenceNumber?: string | null;
  /** Net of VAT. */
  netFils: bigint;
  /** Left out, it follows from the category: government charges carry none. */
  vatBasisPoints?: number;
  notes?: string | null;
}

/**
 * Record a cost and post it, in one transaction.
 *
 * Posted on the day it was incurred, and only the net: whatever VAT is reclaimable is
 * the FTA's, not a cost, exactly as for maintenance and supplier invoices.
 */
export async function recordExpense(input: NewExpense, actorId: string | null) {
  const description = input.description.trim();
  if (!description || input.netFils < 0n) throw new ExpenseRuleError("invalidExpense");

  const needs = allocationDimensions(input.allocation);
  if (needs.needsVehicle && !input.vehicleId) throw new ExpenseRuleError("vehicleRequired");
  if (needs.needsContract && !input.contractId) throw new ExpenseRuleError("contractRequired");

  const vatBasisPoints = input.vatBasisPoints ?? defaultVatBasisPoints(input.category);
  const vatFils = vatOn(input.netFils, vatBasisPoints);

  return prisma.$transaction(async (tx) => {
    let vehicleId: string | null = null;
    let contractId: string | null = null;
    let customerId: string | null = null;

    if (input.allocation === "VEHICLE") {
      const vehicle = await tx.vehicle.findFirst({
        where: { id: input.vehicleId as string, deletedAt: null },
        select: { id: true },
      });
      if (!vehicle) throw new ExpenseRuleError("vehicleNotFound");
      vehicleId = vehicle.id;
    }

    if (input.allocation === "CONTRACT") {
      const contract = await tx.contract.findFirst({
        where: { id: input.contractId as string, deletedAt: null },
        select: { id: true, vehicleId: true, customerId: true },
      });
      if (!contract) throw new ExpenseRuleError("contractNotFound");
      contractId = contract.id;
      // Taken from the contract rather than asked for: a contract's car and customer are
      // facts about the contract, and two places to state them is two places to disagree.
      vehicleId = contract.vehicleId;
      customerId = contract.customerId;
    }

    const expense = await tx.expense.create({
      data: {
        category: input.category,
        allocation: input.allocation,
        vehicleId,
        contractId,
        customerId,
        incurredOn: toDbDate(input.incurredOn),
        description,
        supplierName: input.supplierName?.trim() || null,
        referenceNumber: input.referenceNumber?.trim() || null,
        netFils: input.netFils,
        vatBasisPoints,
        vatFils,
        grossFils: input.netFils + vatFils,
        notes: input.notes?.trim() || null,
        createdById: actorId,
      },
    });

    if (expense.netFils > 0n) {
      await postToLedger(tx, {
        occurredOn: input.incurredOn,
        direction: "COST",
        category: expenseLedgerCategory(input.category),
        // Net: reclaimable VAT is the FTA's, not a cost.
        amountFils: expense.netFils,
        vehicleId,
        contractId,
        customerId,
        sourceType: "Expense",
        sourceId: expense.id,
        memo: description,
      });
    }

    return expense;
  });
}

export interface ExpenseQuery {
  from?: IsoDate;
  to?: IsoDate;
  category?: ExpenseCategory;
  allocation?: ExpenseAllocation;
  vehicleId?: string;
  take?: number;
}

export async function listExpenses(query: ExpenseQuery = {}) {
  return prisma.expense.findMany({
    where: {
      deletedAt: null,
      ...(query.category ? { category: query.category } : {}),
      ...(query.allocation ? { allocation: query.allocation } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.from || query.to
        ? {
            incurredOn: {
              ...(query.from ? { gte: toDbDate(query.from) } : {}),
              ...(query.to ? { lte: toDbDate(query.to) } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ incurredOn: "desc" }, { createdAt: "desc" }],
    take: query.take ?? 200,
    include: {
      vehicle: { select: { id: true, code: true, make: true, model: true, plateCode: true, plateNumber: true } },
      contract: { select: { id: true, number: true } },
    },
  });
}

/** What each kind of expense came to over a period, for the breakdown on the screen. */
export async function expenseTotals(query: ExpenseQuery = {}) {
  const rows = await prisma.expense.groupBy({
    by: ["category"],
    where: {
      deletedAt: null,
      ...(query.allocation ? { allocation: query.allocation } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.from || query.to
        ? {
            incurredOn: {
              ...(query.from ? { gte: toDbDate(query.from) } : {}),
              ...(query.to ? { lte: toDbDate(query.to) } : {}),
            },
          }
        : {}),
    },
    _sum: { netFils: true },
  });

  return rows
    .map((row) => ({ category: row.category, netFils: row._sum.netFils ?? 0n }))
    .sort((a, b) => (b.netFils > a.netFils ? 1 : b.netFils < a.netFils ? -1 : 0));
}
