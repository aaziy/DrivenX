/**
 * Dashboard figures (P1E-01, P1E-02).
 *
 * Every money figure about performance — revenue, cost, profit — is a sum over the
 * ledger for the month, never a stored total (INV-6). Balances are not performance: what
 * customers owe and what DrivenX owes its suppliers are read from the issued invoices
 * that make them up. Counts of cars and contracts are state, read from where the state
 * lives.
 */

import { addDays, periodMonthOf, type IsoDate } from "@drivenx/core";

import { toDbDate } from "./dates";
import { prisma } from "./index";

export interface FleetCounts {
  total: number;
  owned: number;
  leased: number;
  available: number;
  /** On a live contract: Rented or Lease-to-own. */
  onContract: number;
}

export interface MonthResult {
  periodMonth: number;
  revenueFils: bigint;
  costFils: bigint;
  profitFils: bigint;
}

export interface Receivables {
  /** Issued, not waived, not yet paid — gross, as invoiced. */
  outstandingFils: bigint;
  overdueFils: bigint;
  overdueCount: number;
}

export interface Payables {
  /** Raised supplier invoices not yet paid. */
  outstandingFils: bigint;
  overdueFils: bigint;
}

const LIVE = ["ACTIVE", "OVERDUE"] as const;

export async function fleetCounts(): Promise<FleetCounts> {
  const rows = await prisma.vehicle.groupBy({
    by: ["status", "ownershipType"],
    where: { deletedAt: null, status: { not: "SOLD" } },
    _count: true,
  });
  const sum = (match: (row: (typeof rows)[number]) => boolean) =>
    rows.filter(match).reduce((total, row) => total + row._count, 0);

  return {
    total: sum(() => true),
    owned: sum((row) => row.ownershipType === "COMPANY_OWNED"),
    leased: sum((row) => row.ownershipType === "B2B_SUPPLIER"),
    available: sum((row) => row.status === "AVAILABLE"),
    onContract: sum((row) => row.status === "RENTED" || row.status === "LEASE_TO_OWN"),
  };
}

/**
 * Live contracts, the customers on them, and how many are behind.
 *
 * "Behind" is read from the instalments — issued, unpaid and past due today — rather than
 * the stored Overdue status, which only moves when the nightly run does. Otherwise the
 * count could say none while the collections list beside it shows late payments.
 */
export async function contractCounts(
  today: IsoDate,
): Promise<{ active: number; overdue: number; activeCustomers: number }> {
  const live = { deletedAt: null, status: { in: [...LIVE] } };
  const [active, overdue, customers] = await Promise.all([
    prisma.contract.count({ where: live }),
    prisma.contract.count({
      where: {
        ...live,
        installments: {
          some: {
            invoiceNumber: { not: null },
            waivedAt: null,
            dueDate: { lt: toDbDate(today) },
            status: { not: "PAID" },
          },
        },
      },
    }),
    prisma.contract.findMany({ where: live, distinct: ["customerId"], select: { customerId: true } }),
  ]);
  return { active, overdue, activeCustomers: customers.length };
}

/** Revenue, cost and profit for the month containing `day`, from the ledger alone. */
export async function monthResult(day: IsoDate): Promise<MonthResult> {
  const periodMonth = periodMonthOf(day);
  const rows = await prisma.ledgerEntry.groupBy({
    by: ["direction"],
    where: { periodMonth },
    _sum: { amountFils: true },
  });
  // Reversals carry negative amounts, so a plain sum is already net of them.
  const total = (direction: "REVENUE" | "COST") =>
    rows.find((row) => row.direction === direction)?._sum.amountFils ?? 0n;
  const revenueFils = total("REVENUE");
  const costFils = total("COST");
  return { periodMonth, revenueFils, costFils, profitFils: revenueFils - costFils };
}

export async function receivables(today: IsoDate): Promise<Receivables> {
  const [open] = await prisma.$queryRaw<Array<{ outstanding: bigint; overdue: bigint; overdue_count: bigint }>>`
    SELECT
      COALESCE(SUM(i.gross_fils - i.paid_fils), 0)::bigint AS outstanding,
      COALESCE(SUM(i.gross_fils - i.paid_fils) FILTER (WHERE i.due_date < ${toDbDate(today)}), 0)::bigint AS overdue,
      COUNT(*) FILTER (WHERE i.due_date < ${toDbDate(today)}) AS overdue_count
    FROM installments i
    JOIN contracts c ON c.id = i.contract_id AND c.deleted_at IS NULL
    WHERE i.invoice_number IS NOT NULL AND i.waived_at IS NULL AND i.paid_fils < i.gross_fils`;
  return {
    outstandingFils: open?.outstanding ?? 0n,
    overdueFils: open?.overdue ?? 0n,
    overdueCount: Number(open?.overdue_count ?? 0n),
  };
}

export async function payables(today: IsoDate): Promise<Payables> {
  const [open] = await prisma.$queryRaw<Array<{ outstanding: bigint; overdue: bigint }>>`
    SELECT
      COALESCE(SUM(amount_fils - paid_fils), 0)::bigint AS outstanding,
      COALESCE(SUM(amount_fils - paid_fils) FILTER (WHERE due_date < ${toDbDate(today)}), 0)::bigint AS overdue
    FROM supplier_invoices
    WHERE raised_on IS NOT NULL AND paid_fils < amount_fils`;
  return { outstandingFils: open?.outstanding ?? 0n, overdueFils: open?.overdue ?? 0n };
}

export interface OverdueItem {
  installmentId: string;
  contractId: string;
  contractNumber: string;
  customerName: string;
  dueDate: Date;
  owedFils: bigint;
}

/** The oldest unpaid instalments past due — the collections list. */
export async function overdueInstallments(today: IsoDate, take = 10): Promise<OverdueItem[]> {
  const rows = await prisma.installment.findMany({
    where: {
      invoiceNumber: { not: null },
      waivedAt: null,
      dueDate: { lt: toDbDate(today) },
      status: { in: ["OVERDUE", "PARTIALLY_PAID", "DUE"] },
      contract: { deletedAt: null },
    },
    orderBy: [{ dueDate: "asc" }, { sequence: "asc" }],
    take,
    select: {
      id: true,
      dueDate: true,
      grossFils: true,
      paidFils: true,
      contract: { select: { id: true, number: true, customer: { select: { fullName: true } } } },
    },
  });
  return rows.map((row) => ({
    installmentId: row.id,
    contractId: row.contract.id,
    contractNumber: row.contract.number,
    customerName: row.contract.customer.fullName,
    dueDate: row.dueDate,
    owedFils: row.grossFils - row.paidFils,
  }));
}

/** Current documents expiring within `days`, soonest first, and the ones already expired. */
export async function expiringDocuments(today: IsoDate, days = 30) {
  const horizon = toDbDate(addDays(today, days));
  const where = {
    deletedAt: null,
    status: { not: "REPLACED" as const },
    expiryDate: { not: null, lte: horizon },
  };
  const [count, soonest] = await Promise.all([
    prisma.document.count({ where }),
    prisma.document.findMany({
      where,
      orderBy: { expiryDate: "asc" },
      take: 10,
      select: {
        id: true,
        ownerType: true,
        ownerId: true,
        expiryDate: true,
        category: { select: { key: true, label: true, isSystem: true } },
      },
    }),
  ]);
  return { count, soonest };
}
