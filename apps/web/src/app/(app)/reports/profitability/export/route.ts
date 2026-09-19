import { getFormatter, getTranslations } from "next-intl/server";

import { can } from "@drivenx/auth";
import { businessDate } from "@drivenx/core";
import { profitReport, type ProfitFigures } from "@drivenx/db";

import { currentLocale } from "@/i18n/locale";
import { currentPrincipal } from "@/lib/auth";
import { type Cell, xlsxFile, xlsxResponse } from "@/lib/export/xlsx";
import { monthInput, profitabilityQuery } from "@/lib/reports/range";

/**
 * The profitability report as Excel (P1E-09): the same view and months as the screen,
 * read from the same query string, in the reader's language. The total row is written
 * as figures, not a formula, so the file matches the screen to the fil.
 */
export async function GET(request: Request) {
  const principal = await currentPrincipal();
  if (!principal) return new Response(null, { status: 401 });
  if (!can(principal, "report.financial") || !can(principal, "report.export")) {
    return new Response(null, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const query = profitabilityQuery(
    { view: params.get("view"), from: params.get("from"), to: params.get("to") },
    businessDate(new Date()),
  );
  if (!query.valid) return new Response(null, { status: 400 });

  const [t, format, locale, report] = await Promise.all([
    getTranslations("reports"),
    getFormatter(),
    currentLocale(),
    profitReport(query.view, query.from, query.to),
  ]);

  const monthLabel = (period: string) =>
    format.dateTime(new Date(Date.UTC(Math.floor(Number(period) / 100), (Number(period) % 100) - 1, 1)), {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });

  // Same rule as the screen: a column that is zero throughout is left out.
  const otherRevenue = report.rows.some((r) => r.otherRevenueFils !== 0n);
  const otherCost = report.rows.some((r) => r.otherCostFils !== 0n);

  const header = [
    t(`columns.${query.view}`),
    t("columns.rental"),
    t("columns.insurance"),
    ...(otherRevenue ? [t("columns.otherRevenue")] : []),
    t("columns.revenue"),
    t("columns.supplierCost"),
    ...(otherCost ? [t("columns.otherCost")] : []),
    t("columns.cost"),
    t("columns.profit"),
  ];
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

  const rows: Cell[][] = report.rows.map((row) => [
    row.key === null ? t(`unassigned.${query.view}`) : query.view === "month" ? monthLabel(row.key) : row.label,
    ...figures(row),
  ]);
  rows.push([t("total"), ...figures(report.total)]);

  const file = xlsxFile(t("profitabilityTitle"), header, rows, locale === "ar");
  return xlsxResponse(file, `profitability-${query.view}-${monthInput(query.from)}-to-${monthInput(query.to)}.xlsx`);
}
