import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { can } from "@drivenx/auth";
import { businessDate, LEAD_FUNNEL } from "@drivenx/core";
import { leadFunnel, type FunnelCounts } from "@drivenx/db";

import { requirePermission } from "@/lib/auth";
import { salespeople } from "@/lib/leads";
import { statementRange } from "@/lib/reports/range";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("funnel");
  return { title: `${t("title")} · DrivenX` };
}

/**
 * The conversion funnel (P1F-06), for the leads recorded in a period. Scoped like the
 * leads themselves: a salesperson sees their own funnel, a manager anyone's.
 */
export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; salesperson?: string }>;
}) {
  const principal = await requirePermission("report.view");
  if (!can(principal, "lead.view")) forbidden();
  const params = await searchParams;
  const seeAll = can(principal, "lead.view_all");
  const range = statementRange(params, businessDate(new Date()));

  const [t, tStatus, tSources, format, funnel, people] = await Promise.all([
    getTranslations("funnel"),
    getTranslations("leads.status"),
    getTranslations("leads.sources"),
    getFormatter(),
    range.valid
      ? leadFunnel({
          from: range.from,
          to: range.to,
          scope: { id: principal.id, seeAll },
          salespersonId: params.salesperson || null,
        })
      : null,
    seeAll ? salespeople() : [],
  ]);

  const percent = (part: number, whole: number) =>
    whole === 0 ? "—" : format.number(part / whole, { style: "percent", maximumFractionDigits: 0 });
  const contracted = (counts: FunnelCounts) => counts.reached[LEAD_FUNNEL.length - 1] ?? 0;
  // Qualified, Deal created and Contracted are the stages worth a column; New is `created`.
  const stageAt = (counts: FunnelCounts, stage: (typeof LEAD_FUNNEL)[number]) =>
    counts.reached[LEAD_FUNNEL.indexOf(stage)] ?? 0;

  const breakdown = (rows: Array<FunnelCounts & { label: string; key: string }>, firstColumn: string) => (
    <div style={{ overflowX: "auto" }}>
      <table className="data">
        <thead>
          <tr>
            <th>{firstColumn}</th>
            <th className="numeric">{t("columns.created")}</th>
            <th className="numeric">{t("columns.qualified")}</th>
            <th className="numeric">{t("columns.deal")}</th>
            <th className="numeric">{t("columns.contracted")}</th>
            <th className="numeric">{t("columns.lost")}</th>
            <th className="numeric">{t("columns.rate")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td style={{ fontWeight: 560 }}>{row.label}</td>
              <td className="numeric">{row.created}</td>
              <td className="numeric">{stageAt(row, "QUALIFIED")}</td>
              <td className="numeric">{stageAt(row, "DEAL_CREATED")}</td>
              <td className="numeric">{contracted(row)}</td>
              <td className="numeric muted">{row.lost}</td>
              <td className="numeric">{percent(contracted(row), row.created)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("title")}</h1>
          <p className="page-subtitle">{t("subtitle")}</p>
        </div>
      </header>

      <div className="page-body stack">
        <form method="get" className="card">
          <div className="card-body row" style={{ gap: 12, alignItems: "end", flexWrap: "wrap" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="from">{t("from")}</label>
              <input id="from" name="from" type="date" dir="ltr" defaultValue={range.from} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="to">{t("to")}</label>
              <input id="to" name="to" type="date" dir="ltr" defaultValue={range.to} />
            </div>
            {seeAll ? (
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="salesperson">{t("salesperson")}</label>
                <select id="salesperson" name="salesperson" defaultValue={params.salesperson ?? ""}>
                  <option value="">{t("everyone")}</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <button type="submit" className="btn-primary">
              {t("apply")}
            </button>
          </div>
        </form>

        {!funnel ? (
          <div className="card">
            <div className="card-body">
              <p className="field-error">{t("rangeInvalid")}</p>
            </div>
          </div>
        ) : funnel.created === 0 ? (
          <div className="card">
            <div className="card-body">
              <p className="muted">{t("empty")}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="card">
              <div className="card-header">
                <h2>{t("stagesTitle")}</h2>
                <span className="muted">
                  {t("headline", {
                    created: funnel.created,
                    contracted: contracted(funnel),
                    rate: percent(contracted(funnel), funnel.created),
                  })}
                </span>
              </div>
              <div className="card-body stack" style={{ gap: 10 }}>
                {LEAD_FUNNEL.map((stage, index) => {
                  const reached = funnel.reached[index] ?? 0;
                  return (
                    <div key={stage} className="funnel-row">
                      <span className="funnel-label">{tStatus(stage)}</span>
                      <span className="funnel-track" aria-hidden="true">
                        <span
                          className="funnel-bar"
                          style={{ width: `${funnel.created === 0 ? 0 : (reached / funnel.created) * 100}%` }}
                        />
                      </span>
                      <span className="funnel-value">
                        <strong>{reached}</strong>{" "}
                        <span className="muted">{t("stageShare", { share: percent(reached, funnel.created) })}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h2>{t("lostTitle")}</h2>
                <span className="muted">{t("lostCount", { count: funnel.lost })}</span>
              </div>
              {funnel.lostReasons.length === 0 ? (
                <div className="card-body">
                  <p className="muted">{t("noReasons")}</p>
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>{t("reason")}</th>
                        <th className="numeric">{t("count")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funnel.lostReasons.map((row) => (
                        <tr key={row.reason}>
                          <td>
                            <bdi>{row.reason}</bdi>
                          </td>
                          <td className="numeric">{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {seeAll ? (
              <div className="card">
                <div className="card-header">
                  <h2>{t("bySalespersonTitle")}</h2>
                </div>
                {breakdown(
                  funnel.bySalesperson.map((row) => ({
                    ...row,
                    key: row.salespersonId ?? "none",
                    label: row.name ?? t("unassigned"),
                  })),
                  t("columns.who"),
                )}
              </div>
            ) : null}

            <div className="card">
              <div className="card-header">
                <h2>{t("bySourceTitle")}</h2>
              </div>
              {breakdown(
                funnel.bySource.map((row) => ({ ...row, key: row.source, label: tSources(row.source) })),
                t("columns.source"),
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
