import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { businessDate, Money } from "@drivenx/core";
import {
  contractCounts,
  expiringDocuments,
  fleetCounts,
  fromDbDate,
  monthResult,
  overdueInstallments,
  payables,
  receivables,
} from "@drivenx/db";

import { seededCategoryKey } from "@/i18n/labels";
import { requirePermission } from "@/lib/auth";
import { resolveDocumentEntities } from "@/lib/notifications";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: `${t("title")} · DrivenX` };
}

/** Whole days from one calendar date to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * The dashboard (P1E-02, P1E-03).
 *
 * Each block is shown to whoever may see what it summarises: anyone on the dashboard sees
 * the fleet and contract counts; profit needs the financial reports; what customers owe
 * needs payments; what is owed to suppliers needs the payables. The money for the month
 * is the ledger for the month (INV-6), computed in @drivenx/db, never here.
 */
export default async function DashboardPage() {
  const principal = await requirePermission("dashboard.view");
  const can = (key: Parameters<typeof principal.permissions.has>[0]) => principal.permissions.has(key);
  const today = businessDate(new Date());

  const [t, tCat, format, fleet, contracts, month, owed, owing, late, expiring] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("documentCategories"),
    getFormatter(),
    fleetCounts(),
    contractCounts(today),
    can("report.financial") ? monthResult(today) : null,
    can("payment.view") ? receivables(today) : null,
    can("supplier_invoice.view") ? payables(today) : null,
    can("payment.view") ? overdueInstallments(today) : [],
    can("document.view") ? expiringDocuments(today) : null,
  ]);

  const entities = expiring ? await resolveDocumentEntities(expiring.soonest.map((d) => d.id)) : new Map();

  const firstName = principal.fullName.split(" ")[0] ?? principal.fullName;
  const monthName = format.dateTime(new Date(`${today}T00:00:00Z`), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const day = (date: Date) => format.dateTime(date, { dateStyle: "medium", timeZone: "UTC" });

  const stat = (label: string, value: string | number, note?: string, tone?: "negative") => (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ""}`.trim()}>{value}</div>
      {note ? <div className="stat-note">{note}</div> : null}
    </div>
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("greeting", { name: firstName })}</h1>
          <p className="page-subtitle">{t("subtitle", { month: monthName })}</p>
        </div>
      </header>

      <div className="page-body stack">
        {month ? (
          <section aria-labelledby="month-heading" className="stack" style={{ gap: 8 }}>
            <h2 id="month-heading" className="section-title">
              {t("monthTitle", { month: monthName })}
            </h2>
            <div className="stat-grid">
              {stat(t("revenue"), Money.format(month.revenueFils), t("netOfVat"))}
              {stat(t("cost"), Money.format(month.costFils), t("netOfVat"))}
              {stat(
                t("profit"),
                Money.format(month.profitFils),
                undefined,
                month.profitFils < 0n ? "negative" : undefined,
              )}
            </div>
          </section>
        ) : null}

        {owed || owing || expiring ? (
          <section aria-labelledby="balances-heading" className="stack" style={{ gap: 8 }}>
            <h2 id="balances-heading" className="section-title">
              {t("balancesTitle")}
            </h2>
            <div className="stat-grid">
              {owed
                ? stat(
                    t("customerOutstanding"),
                    Money.format(owed.outstandingFils),
                    owed.overdueFils > 0n ? t("overdueNote", { amount: Money.format(owed.overdueFils) }) : undefined,
                  )
                : null}
              {owing
                ? stat(
                    t("supplierPayables"),
                    Money.format(owing.outstandingFils),
                    owing.overdueFils > 0n ? t("overdueNote", { amount: Money.format(owing.overdueFils) }) : undefined,
                  )
                : null}
              {expiring ? stat(t("documentsExpiring"), expiring.count, t("documentsNote")) : null}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="fleet-heading" className="stack" style={{ gap: 8 }}>
          <h2 id="fleet-heading" className="section-title">
            {t("fleetTitle")}
          </h2>
          <div className="stat-grid">
            {stat(t("fleetTotal"), fleet.total)}
            {stat(t("fleetOwned"), fleet.owned)}
            {stat(t("fleetLeased"), fleet.leased)}
            {stat(t("fleetAvailable"), fleet.available)}
            {stat(t("fleetOnContract"), fleet.onContract)}
          </div>
        </section>

        <section aria-labelledby="contracts-heading" className="stack" style={{ gap: 8 }}>
          <h2 id="contracts-heading" className="section-title">
            {t("contractsTitle")}
          </h2>
          <div className="stat-grid">
            {stat(t("activeContracts"), contracts.active)}
            {stat(t("activeCustomers"), contracts.activeCustomers)}
            {stat(
              t("overdueContracts"),
              contracts.overdue,
              undefined,
              contracts.overdue > 0 ? "negative" : undefined,
            )}
          </div>
        </section>

        {can("payment.view") ? (
          <div className="card">
            <div className="card-header">
              <h2>{t("overdueTitle")}</h2>
              {owed && owed.overdueCount > 0 ? (
                <span className="muted">{t("overdueCount", { count: owed.overdueCount })}</span>
              ) : null}
            </div>
            {late.length === 0 ? (
              <div className="card-body">
                <p className="muted">{t("overdueEmpty")}</p>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t("columns.contract")}</th>
                      <th>{t("columns.customer")}</th>
                      <th>{t("columns.due")}</th>
                      <th>{t("columns.daysLate")}</th>
                      <th className="numeric">{t("columns.owed")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {late.map((item) => (
                      <tr key={item.installmentId}>
                        <td>
                          <Link href={`/contracts/${item.contractId}`}>
                            <bdi>{item.contractNumber}</bdi>
                          </Link>
                        </td>
                        <td>
                          <bdi>{item.customerName}</bdi>
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>{day(item.dueDate)}</td>
                        <td className="negative" style={{ whiteSpace: "nowrap" }}>
                          {t("daysLate", { days: daysBetween(fromDbDate(item.dueDate), today) })}
                        </td>
                        <td className="numeric" style={{ whiteSpace: "nowrap" }}>
                          {Money.format(item.owedFils)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        {expiring ? (
          <div className="card">
            <div className="card-header">
              <h2>{t("expiringTitle")}</h2>
            </div>
            {expiring.soonest.length === 0 ? (
              <div className="card-body">
                <p className="muted">{t("expiringEmpty")}</p>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="data">
                  <tbody>
                    {expiring.soonest.map((document) => {
                      const entity = entities.get(document.id);
                      const key = seededCategoryKey(document.category);
                      // Expiry is a moment, not a calendar date: compare it with now.
                      const expired = document.expiryDate !== null && document.expiryDate < new Date();
                      return (
                        <tr key={document.id}>
                          <td style={{ fontWeight: 560 }}>
                            {key ? tCat(`defaultLabels.${key}`) : document.category.label}
                          </td>
                          <td className="muted">{entity ? <bdi>{entity.who}</bdi> : null}</td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {document.expiryDate
                              ? format.dateTime(document.expiryDate, { dateStyle: "medium" })
                              : null}{" "}
                            {expired ? <span className="badge badge-danger">{t("expired")}</span> : null}
                          </td>
                          <td style={{ width: 1, whiteSpace: "nowrap" }}>
                            {entity ? (
                              <Link className="btn-secondary" href={entity.href}>
                                {t("open")}
                              </Link>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}
