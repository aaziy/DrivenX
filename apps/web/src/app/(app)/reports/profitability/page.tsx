import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { businessDate, Money } from "@drivenx/core";
import { categoryTotals, profitReport, REPORT_DIMENSIONS, type ProfitFigures } from "@drivenx/db";

import { CategoryBreakdown } from "@/components/category-breakdown";
import { requirePermission } from "@/lib/auth";
import { salespeople } from "@/lib/leads";
import { monthInput, profitabilityQuery } from "@/lib/reports/range";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reports");
  return { title: `${t("profitabilityTitle")} · DrivenX` };
}

/**
 * Profitability (P1E-05, P1E-06), by vehicle, customer, supplier, contract or month.
 *
 * The filters are a plain GET form, so a report is a link: bookmarkable, shareable, and
 * the back button returns to the previous one.
 */
export default async function ProfitabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; from?: string; to?: string; type?: string; salesperson?: string }>;
}) {
  const principal = await requirePermission("report.financial");
  const params = await searchParams;

  const { view, from, to, valid: rangeValid, filters, search } = profitabilityQuery(params, businessDate(new Date()));

  const [t, tTypes, format, report, breakdown, people] = await Promise.all([
    getTranslations("reports"),
    getTranslations("contracts.types"),
    getFormatter(),
    rangeValid ? profitReport(view, from, to, filters) : null,
    // The same range grouped by what the money was, rather than by whose it was (P2-13).
    rangeValid ? categoryTotals(from, to) : null,
    salespeople(),
  ]);

  const monthLabel = (period: string) =>
    format.dateTime(new Date(Date.UTC(Math.floor(Number(period) / 100), (Number(period) % 100) - 1, 1)), {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  const amount = (fils: bigint) => Money.format(fils, { currency: null });
  const margin = (figures: ProfitFigures) =>
    figures.revenueFils === 0n
      ? "—"
      : format.number(Number((figures.profitFils * 10_000n) / figures.revenueFils) / 10_000, {
          style: "percent",
          maximumFractionDigits: 1,
        });

  // A column that is zero for the whole report is left out, so profit and margin stay on
  // screen. "Other" income and cost are empty until Phase 2 books maintenance and fines;
  // the columns appear by themselves once they carry anything.
  const show = {
    otherRevenue: report ? report.total.otherRevenueFils !== 0n || report.rows.some((r) => r.otherRevenueFils !== 0n) : false,
    otherCost: report ? report.total.otherCostFils !== 0n || report.rows.some((r) => r.otherCostFils !== 0n) : false,
  };

  const figures = (row: ProfitFigures, bold = false) => {
    const cell = (fils: bigint, extra = "") => (
      <td className={`numeric ${extra}`.trim()} style={{ whiteSpace: "nowrap", fontWeight: bold ? 650 : undefined }}>
        {amount(fils)}
      </td>
    );
    return (
      <>
        {cell(row.rentalFils)}
        {cell(row.insuranceFils)}
        {show.otherRevenue ? cell(row.otherRevenueFils, "muted") : null}
        {cell(row.revenueFils)}
        {cell(row.supplierCostFils)}
        {show.otherCost ? cell(row.otherCostFils, "muted") : null}
        {cell(row.costFils)}
        {cell(row.profitFils, row.profitFils < 0n ? "negative" : "")}
        <td className="numeric muted" style={{ whiteSpace: "nowrap" }}>
          {margin(row)}
        </td>
      </>
    );
  };

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("profitabilityTitle")}</h1>
          <p className="page-subtitle">{t("profitabilitySubtitle")}</p>
        </div>
      </header>

      <div className="page-body stack">
        <form method="get" className="card">
          <div className="card-body row" style={{ gap: 12, alignItems: "end", flexWrap: "wrap" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="view">{t("view")}</label>
              <select id="view" name="view" defaultValue={view}>
                {REPORT_DIMENSIONS.map((d) => (
                  <option key={d} value={d}>
                    {t(`views.${d}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="from">{t("from")}</label>
              <input id="from" name="from" type="month" dir="ltr" defaultValue={monthInput(from)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="to">{t("to")}</label>
              <input id="to" name="to" type="month" dir="ltr" defaultValue={monthInput(to)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="type">{t("contractType")}</label>
              <select id="type" name="type" defaultValue={filters.contractType ?? ""}>
                <option value="">{t("anyType")}</option>
                {(["LONG_TERM_RENTAL", "LEASE_TO_OWN", "B2B_RENTAL", "OTHER"] as const).map((type) => (
                  <option key={type} value={type}>
                    {tTypes(type)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="salesperson">{t("salesperson")}</label>
              <select id="salesperson" name="salesperson" defaultValue={filters.salespersonId ?? ""}>
                <option value="">{t("anySalesperson")}</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn-primary">
              {t("apply")}
            </button>
          </div>
        </form>

        {breakdown && breakdown.length > 0 ? (
          <div className="card">
            <div className="card-header">
              <h2>{t("breakdownTitle")}</h2>
            </div>
            <div className="card-body">
              <p className="field-hint">{t("breakdownHint")}</p>
              <CategoryBreakdown totals={breakdown} />
            </div>
          </div>
        ) : null}

        <div className="card">
          <div className="card-header">
            <h2>
              {monthLabel(String(from))} – {monthLabel(String(to))}
            </h2>
            <span className="row" style={{ gap: 12, alignItems: "center" }}>
              {report ? <span className="muted">{t("rowCount", { count: report.rows.length })}</span> : null}
              {report && report.rows.length > 0 && principal.permissions.has("report.export") ? (
                // Plain links: the browser downloads the file itself.
                <>
                  <a
                    className="btn-secondary"
                    href={`/reports/profitability/export?${search}`}
                  >
                    {t("exportExcel")}
                  </a>
                  <a
                    className="btn-secondary"
                    href={`/reports/profitability/export?${search}&format=pdf`}
                  >
                    {t("exportPdf")}
                  </a>
                </>
              ) : null}
            </span>
          </div>

          {!report ? (
            <div className="card-body">
              <p className="field-error">{t("rangeInvalid")}</p>
            </div>
          ) : report.rows.length === 0 ? (
            <div className="card-body">
              <p className="muted">{t("empty")}</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data" aria-label={t("profitabilityTitle")}>
                <thead>
                  <tr>
                    <th>{t(`columns.${view}`)}</th>
                    <th className="numeric">{t("columns.rental")}</th>
                    <th className="numeric">{t("columns.insurance")}</th>
                    {show.otherRevenue ? <th className="numeric">{t("columns.otherRevenue")}</th> : null}
                    <th className="numeric">{t("columns.revenue")}</th>
                    <th className="numeric">{t("columns.supplierCost")}</th>
                    {show.otherCost ? <th className="numeric">{t("columns.otherCost")}</th> : null}
                    <th className="numeric">{t("columns.cost")}</th>
                    <th className="numeric">{t("columns.profit")}</th>
                    <th className="numeric">{t("columns.margin")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row.key ?? "unassigned"}>
                      <td style={{ minWidth: 200 }}>
                        {row.key === null ? (
                          <span className="muted">{t(`unassigned.${view}`)}</span>
                        ) : view === "month" ? (
                          monthLabel(row.key)
                        ) : row.href ? (
                          <Link href={row.href}>
                            <bdi>{row.label}</bdi>
                          </Link>
                        ) : (
                          <bdi>{row.label}</bdi>
                        )}
                      </td>
                      {figures(row)}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="report-total">
                    <td style={{ fontWeight: 650 }}>{t("total")}</td>
                    {figures(report.total, true)}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
