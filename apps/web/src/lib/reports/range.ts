import { isIsoDate } from "@drivenx/core";
import { REPORT_DIMENSIONS, type ReportDimension, type ReportFilters } from "@drivenx/db";

const CONTRACT_TYPES = ["LONG_TERM_RENTAL", "LEASE_TO_OWN", "B2B_RENTAL", "OTHER"] as const;

/** "2026-03" from a month input, as the ledger's 202603; null when it is not one. */
export function parseMonth(value: string | undefined | null): number | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value ?? "");
  return match ? Number(match[1]) * 100 + Number(match[2]) : null;
}

/** 202603 as "2026-03", for a month input. */
export const monthInput = (period: number) => `${Math.floor(period / 100)}-${String(period % 100).padStart(2, "0")}`;

/**
 * The profitability report's view and months from a query string, read the same way by
 * the page and by its export, so a download is exactly what was on screen. The range
 * defaults to this year to date.
 */
export function profitabilityQuery(
  params: {
    view?: string | null;
    from?: string | null;
    to?: string | null;
    type?: string | null;
    salesperson?: string | null;
  },
  today: string,
): { view: ReportDimension; from: number; to: number; valid: boolean; filters: ReportFilters; search: string } {
  const thisMonth = Number(today.slice(0, 4)) * 100 + Number(today.slice(5, 7));
  const view = REPORT_DIMENSIONS.find((d) => d === params.view) ?? "vehicle";
  const from = parseMonth(params.from) ?? Math.floor(thisMonth / 100) * 100 + 1;
  const to = parseMonth(params.to) ?? thisMonth;
  const contractType = CONTRACT_TYPES.find((type) => type === params.type) ?? null;
  const salespersonId = params.salesperson || null;
  // The same query, as a string, for links to exports of exactly this report.
  const search = new URLSearchParams({
    view,
    from: monthInput(from),
    to: monthInput(to),
    ...(contractType ? { type: contractType } : {}),
    ...(salespersonId ? { salesperson: salespersonId } : {}),
  }).toString();
  return { view, from, to, valid: from <= to, filters: { contractType, salespersonId }, search };
}

/** A statement's range from the query string: this year to date unless told otherwise. */
export function statementRange(
  params: { from?: string; to?: string },
  today: string,
): { from: string; to: string; valid: boolean } {
  const from = params.from && isIsoDate(params.from) ? params.from : `${today.slice(0, 4)}-01-01`;
  const to = params.to && isIsoDate(params.to) ? params.to : today;
  return { from, to, valid: from <= to };
}
