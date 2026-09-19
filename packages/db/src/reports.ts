/**
 * Profitability reports (P1E-05, P1E-06).
 *
 * One query shape for every view: the ledger for a range of months, grouped by the chosen
 * dimension and by category. Revenue is split into rental, insurance and other, so
 * insurance never hides inside rental (SOW §11); cost is split into the supplier lease
 * and everything else, which is where Phase 2's maintenance, fines and repairs will land
 * until they earn columns of their own.
 *
 * Entries with no value for the dimension — revenue on a car the company owns has no
 * supplier — are reported on a row of their own rather than dropped. That is what makes
 * every report add up to the same total: the ledger for the range (INV-6).
 */

import { prisma } from "./index";

export const REPORT_DIMENSIONS = ["vehicle", "customer", "supplier", "contract", "month"] as const;
export type ReportDimension = (typeof REPORT_DIMENSIONS)[number];

export interface ProfitFigures {
  rentalFils: bigint;
  insuranceFils: bigint;
  otherRevenueFils: bigint;
  revenueFils: bigint;
  supplierCostFils: bigint;
  otherCostFils: bigint;
  costFils: bigint;
  profitFils: bigint;
}

export interface ProfitRow extends ProfitFigures {
  /** The dimension's id, the month as YYYYMM, or null for entries it does not apply to. */
  key: string | null;
  label: string;
  /** Where the row's record lives, when it has one. */
  href: string | null;
}

export interface ProfitReport {
  dimension: ReportDimension;
  fromMonth: number;
  toMonth: number;
  rows: ProfitRow[];
  total: ProfitFigures;
}

type LedgerSum = { key: string | null; direction: string; category: string; amount: bigint };

/**
 * The ledger for the range, summed by the dimension, direction and category.
 *
 * One written-out query per dimension rather than a Prisma.sql fragment interpolated
 * into the client's tagged template: in the web bundle the fragment was not recognised
 * as SQL and was sent as a bound value, so every row's key came back as the fragment.
 * (search.ts builds its whole statement with Prisma.sql and passes it as one argument,
 * which works.)
 */
function ledgerSums(dimension: ReportDimension, fromMonth: number, toMonth: number): Promise<LedgerSum[]> {
  // Reversals are negative, so summing everything is already net of them.
  switch (dimension) {
    case "vehicle":
      return prisma.$queryRaw<LedgerSum[]>`
        SELECT vehicle_id AS key, direction::text AS direction, category, SUM(amount_fils)::bigint AS amount
        FROM ledger_entries WHERE period_month BETWEEN ${fromMonth} AND ${toMonth} GROUP BY 1, 2, 3`;
    case "customer":
      return prisma.$queryRaw<LedgerSum[]>`
        SELECT customer_id AS key, direction::text AS direction, category, SUM(amount_fils)::bigint AS amount
        FROM ledger_entries WHERE period_month BETWEEN ${fromMonth} AND ${toMonth} GROUP BY 1, 2, 3`;
    case "supplier":
      return prisma.$queryRaw<LedgerSum[]>`
        SELECT supplier_id AS key, direction::text AS direction, category, SUM(amount_fils)::bigint AS amount
        FROM ledger_entries WHERE period_month BETWEEN ${fromMonth} AND ${toMonth} GROUP BY 1, 2, 3`;
    case "contract":
      return prisma.$queryRaw<LedgerSum[]>`
        SELECT contract_id AS key, direction::text AS direction, category, SUM(amount_fils)::bigint AS amount
        FROM ledger_entries WHERE period_month BETWEEN ${fromMonth} AND ${toMonth} GROUP BY 1, 2, 3`;
    case "month":
      return prisma.$queryRaw<LedgerSum[]>`
        SELECT period_month::text AS key, direction::text AS direction, category, SUM(amount_fils)::bigint AS amount
        FROM ledger_entries WHERE period_month BETWEEN ${fromMonth} AND ${toMonth} GROUP BY 1, 2, 3`;
  }
}

function empty(): ProfitFigures {
  return {
    rentalFils: 0n,
    insuranceFils: 0n,
    otherRevenueFils: 0n,
    revenueFils: 0n,
    supplierCostFils: 0n,
    otherCostFils: 0n,
    costFils: 0n,
    profitFils: 0n,
  };
}

/** Adds one ledger sum to a row, into the column its category belongs to. */
function add(figures: ProfitFigures, direction: string, category: string, amount: bigint): void {
  if (direction === "REVENUE") {
    if (category === "revenue.rental") figures.rentalFils += amount;
    else if (category === "revenue.insurance") figures.insuranceFils += amount;
    else figures.otherRevenueFils += amount;
    figures.revenueFils += amount;
    figures.profitFils += amount;
  } else {
    if (category === "cost.supplier") figures.supplierCostFils += amount;
    else figures.otherCostFils += amount;
    figures.costFils += amount;
    figures.profitFils -= amount;
  }
}

/** YYYYMM for a year and month, the ledger's period key. */
export function periodMonth(year: number, month: number): number {
  return year * 100 + month;
}

export async function profitReport(
  dimension: ReportDimension,
  fromMonth: number,
  toMonth: number,
): Promise<ProfitReport> {
  const sums = await ledgerSums(dimension, fromMonth, toMonth);

  const byKey = new Map<string | null, ProfitFigures>();
  const total = empty();
  for (const sum of sums) {
    const figures = byKey.get(sum.key) ?? empty();
    add(figures, sum.direction, sum.category, sum.amount);
    add(total, sum.direction, sum.category, sum.amount);
    byKey.set(sum.key, figures);
  }

  const labels = await labelsFor(dimension, [...byKey.keys()].filter((k): k is string => k !== null));
  const rows: ProfitRow[] = [...byKey.entries()].map(([rowKey, figures]) => ({
    key: rowKey,
    label: rowKey === null ? "" : (labels.get(rowKey)?.label ?? rowKey),
    href: rowKey === null ? null : (labels.get(rowKey)?.href ?? null),
    ...figures,
  }));

  // Months run in order; everything else leads with what made the most money, and the
  // unassigned row, if any, comes last.
  rows.sort((a, b) => {
    if (a.key === null) return 1;
    if (b.key === null) return -1;
    if (dimension === "month") return Number(a.key) - Number(b.key);
    return a.profitFils === b.profitFils ? a.label.localeCompare(b.label) : a.profitFils > b.profitFils ? -1 : 1;
  });

  return { dimension, fromMonth, toMonth, rows, total };
}

async function labelsFor(
  dimension: ReportDimension,
  ids: string[],
): Promise<Map<string, { label: string; href: string | null }>> {
  const labels = new Map<string, { label: string; href: string | null }>();
  if (ids.length === 0) return labels;

  switch (dimension) {
    case "vehicle":
      for (const v of await prisma.vehicle.findMany({
        where: { id: { in: ids } },
        select: { id: true, code: true, make: true, model: true, plateCode: true, plateNumber: true },
      })) {
        labels.set(v.id, {
          label: `${v.make} ${v.model} · ${v.plateCode} ${v.plateNumber} (${v.code})`,
          href: `/vehicles/${v.id}`,
        });
      }
      break;
    case "customer":
      for (const c of await prisma.customer.findMany({
        where: { id: { in: ids } },
        select: { id: true, code: true, fullName: true },
      })) {
        labels.set(c.id, { label: `${c.fullName} (${c.code})`, href: `/customers/${c.id}` });
      }
      break;
    case "supplier":
      for (const s of await prisma.supplier.findMany({
        where: { id: { in: ids } },
        select: { id: true, code: true, companyName: true },
      })) {
        labels.set(s.id, { label: `${s.companyName} (${s.code})`, href: `/suppliers/${s.id}` });
      }
      break;
    case "contract":
      for (const c of await prisma.contract.findMany({
        where: { id: { in: ids } },
        select: { id: true, number: true, customer: { select: { fullName: true } } },
      })) {
        labels.set(c.id, { label: `${c.number} · ${c.customer.fullName}`, href: `/contracts/${c.id}` });
      }
      break;
    case "month":
      // Months are labelled by the screen, in the reader's language.
      for (const id of ids) labels.set(id, { label: id, href: null });
      break;
  }
  return labels;
}
