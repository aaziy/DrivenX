/**
 * Each report as one table, rendered to Excel or PDF from the same rows (P1E-09, P1E-10),
 * so the two files cannot drift apart. The words come from the reader's language, as on
 * screen.
 */

import { renderToBuffer } from "@react-pdf/renderer";
import { getFormatter, getTranslations } from "next-intl/server";

import { businessDate, Money } from "@drivenx/core";
import {
  prisma,
  profitReport,
  type ProfitFigures,
  type ReportDimension,
  type ReportFilters,
  type Statement,
} from "@drivenx/db";

import { currentLocale } from "@/i18n/locale";
import { ReportPdf } from "@/lib/pdf/report-pdf";

import { type Cell, xlsxFile, xlsxResponse } from "./xlsx";

export interface ReportTable {
  title: string;
  subtitle: string;
  note?: string;
  columns: Array<{ label: string; numeric?: boolean; weight?: number }>;
  lead?: Cell[];
  rows: Cell[][];
  total?: Cell[];
}

export type ExportFormat = "xlsx" | "pdf";

export function exportFormat(value: string | null): ExportFormat {
  return value === "pdf" ? "pdf" : "xlsx";
}

export async function profitabilityTable(
  view: ReportDimension,
  from: number,
  to: number,
  filters: ReportFilters = {},
): Promise<ReportTable> {
  const [t, tTypes, format, report, salesperson] = await Promise.all([
    getTranslations("reports"),
    getTranslations("contracts.types"),
    getFormatter(),
    profitReport(view, from, to, filters),
    filters.salespersonId
      ? prisma.user.findUnique({ where: { id: filters.salespersonId }, select: { fullName: true } })
      : null,
  ]);
  const monthLabel = (period: number) =>
    format.dateTime(new Date(Date.UTC(Math.floor(period / 100), (period % 100) - 1, 1)), {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });

  // Same rule as the screen: a column that is zero throughout is left out.
  const otherRevenue = report.rows.some((r) => r.otherRevenueFils !== 0n);
  const otherCost = report.rows.some((r) => r.otherCostFils !== 0n);
  const figures = (row: ProfitFigures): Cell[] => [
    { fils: row.rentalFils },
    { fils: row.insuranceFils },
    ...(otherRevenue ? [{ fils: row.otherRevenueFils }] : []),
    { fils: row.revenueFils },
    { fils: row.supplierCostFils },
    ...(otherCost ? [{ fils: row.otherCostFils }] : []),
    { fils: row.costFils },
    { fils: row.profitFils },
  ];
  const money = (label: string) => ({ label, numeric: true });

  return {
    title: t("profitabilityTitle"),
    // A filtered report says so on the page, so a printout cannot pass for the whole.
    subtitle: [
      t(`views.${view}`),
      `${monthLabel(from)} – ${monthLabel(to)}`,
      ...(filters.contractType ? [tTypes(filters.contractType)] : []),
      ...(salesperson ? [salesperson.fullName] : []),
    ].join(" · "),
    note: t("profitabilitySubtitle"),
    columns: [
      { label: t(`columns.${view}`), weight: 3.4 },
      money(t("columns.rental")),
      money(t("columns.insurance")),
      ...(otherRevenue ? [money(t("columns.otherRevenue"))] : []),
      money(t("columns.revenue")),
      money(t("columns.supplierCost")),
      ...(otherCost ? [money(t("columns.otherCost"))] : []),
      money(t("columns.cost")),
      money(t("columns.profit")),
    ],
    rows: report.rows.map((row) => [
      row.key === null ? t(`unassigned.${view}`) : view === "month" ? monthLabel(Number(row.key)) : row.label,
      ...figures(row),
    ]),
    total: [t("total"), ...figures(report.total)],
  };
}

export async function statementTable(
  statement: Statement,
  side: "customer" | "supplier",
  partyName: string,
): Promise<ReportTable> {
  const [t, format] = await Promise.all([getTranslations("statements"), getFormatter()]);
  const day = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const kinds = side === "customer" ? "kinds" : "supplierKinds";
  const money = (label: string) => ({ label, numeric: true, weight: 1.2 });

  return {
    title: t(side === "customer" ? "customerTitle" : "supplierTitle"),
    subtitle: `${partyName} · ${day(statement.from)} – ${day(statement.to)}`,
    note: t("vatNote"),
    columns: [
      { label: t("columns.date"), weight: 1.1 },
      { label: t("columns.item"), weight: 1.8 },
      { label: t("columns.reference"), weight: 1.2 },
      { label: t("columns.contract"), weight: 1 },
      money(t("columns.debit")),
      money(t("columns.credit")),
      money(t("columns.balance")),
    ],
    lead: [null, t("opening"), null, null, null, null, { fils: statement.openingFils }],
    rows: statement.lines.map((line) => [
      day(line.date),
      t(`${kinds}.${line.kind}`),
      line.reference,
      line.contractNumber,
      line.debitFils === 0n ? null : { fils: line.debitFils },
      line.creditFils === 0n ? null : { fils: line.creditFils },
      { fils: line.balanceFils },
    ]),
    total: [
      null,
      t("closing"),
      null,
      null,
      { fils: statement.debitsFils },
      { fils: statement.creditsFils },
      { fils: statement.closingFils },
    ],
  };
}

const asText = (cell: Cell): string =>
  cell === null ? "" : typeof cell === "object" ? Money.format(cell.fils, { currency: null }) : String(cell);

/** The table as a download, in the format asked for, named `baseName` plus extension. */
export async function renderTable(table: ReportTable, format: ExportFormat, baseName: string): Promise<Response> {
  const [locale, tPdf, formatter] = await Promise.all([
    currentLocale(),
    getTranslations("contractPdf"),
    getFormatter(),
  ]);
  const rtl = locale === "ar";

  if (format === "xlsx") {
    const rows = [...(table.lead ? [table.lead] : []), ...table.rows, ...(table.total ? [table.total] : [])];
    return xlsxResponse(xlsxFile(table.title, table.columns.map((c) => c.label), rows, rtl), `${baseName}.xlsx`);
  }

  const generatedOn = formatter.dateTime(new Date(`${businessDate(new Date())}T00:00:00Z`), {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  // Called, not mounted: renderToBuffer takes the <Document> element itself.
  const pdf = await renderToBuffer(
    ReportPdf({
      title: table.title,
      subtitle: table.subtitle,
      note: table.note,
      columns: table.columns,
      lead: table.lead?.map(asText),
      rows: table.rows.map((row) => row.map(asText)),
      total: table.total?.map(asText),
      generated: `${tPdf("generated")} ${generatedOn}`,
      page: (current, total) => tPdf("page", { current, total }),
      direction: rtl ? "rtl" : "ltr",
    }),
  );
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
      "Content-Disposition": `attachment; filename="${baseName}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
