import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { can } from "@drivenx/auth";
import { isLeadStatus, LEAD_FUNNEL, LEAD_STATUSES, normaliseUaeMobile, type LeadStatus } from "@drivenx/core";
import { prisma } from "@drivenx/db";

import { requirePermission } from "@/lib/auth";
import { leadWhere, salespeople } from "@/lib/leads";

import { leadStatusTone } from "./tone";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("leads");
  return { title: `${t("title")} · DrivenX` };
}

const OPEN: LeadStatus[] = ["NEW", "CONTACTED", "QUALIFIED", "DEAL_CREATED"];

/**
 * The pipeline (P1F-03), as a list or a board. Scoped to the reader: Sales Staff see
 * their own leads, managers everyone's, with a salesperson filter (P1F-05).
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; status?: string; salesperson?: string; q?: string }>;
}) {
  const principal = await requirePermission("lead.view");
  const params = await searchParams;
  const seeAll = can(principal, "lead.view_all");

  const view = params.view === "board" ? "board" : "list";
  // The list opens on what still needs work; the board shows every stage anyway.
  const status = params.status === "all" ? "all" : isLeadStatus(params.status ?? "") ? params.status : "open";
  const q = (params.q ?? "").trim();
  const mobile = q ? normaliseUaeMobile(q) : null;

  const where = {
    ...leadWhere(principal),
    ...(seeAll && params.salesperson ? { salespersonId: params.salesperson } : {}),
    ...(view === "list" && status === "open" ? { status: { in: OPEN } } : {}),
    ...(view === "list" && status !== "open" && status !== "all" ? { status: status as LeadStatus } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { code: { contains: q, mode: "insensitive" as const } },
            ...(mobile ? [{ mobile }] : []),
          ],
        }
      : {}),
  };

  const [t, tStatus, tSources, format, leads, people] = await Promise.all([
    getTranslations("leads"),
    getTranslations("leads.status"),
    getTranslations("leads.sources"),
    getFormatter(),
    prisma.lead.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 300,
      include: {
        salesperson: { select: { fullName: true } },
        interestedVehicle: { select: { make: true, model: true } },
      },
    }),
    seeAll ? salespeople() : [],
  ]);

  const query = (patch: Record<string, string>) => {
    const next = new URLSearchParams({
      view,
      ...(status !== "open" ? { status } : {}),
      ...(params.salesperson ? { salesperson: params.salesperson } : {}),
      ...(q ? { q } : {}),
      ...patch,
    });
    return `/leads?${next.toString()}`;
  };

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("title")}</h1>
          <p className="page-subtitle">{t("subtitle")}</p>
        </div>
        {can(principal, "lead.create") ? (
          <Link className="btn-primary" href="/leads/new">
            {t("new")}
          </Link>
        ) : null}
      </header>

      <div className="page-body stack">
        <form method="get" className="card">
          <input type="hidden" name="view" value={view} />
          <div className="card-body row" style={{ gap: 12, alignItems: "end", flexWrap: "wrap" }}>
            <div className="field" style={{ marginBottom: 0, flex: "1 1 220px" }}>
              <label htmlFor="q">{t("filters.search")}</label>
              <input id="q" name="q" defaultValue={q} />
            </div>
            {view === "list" ? (
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="status">{t("filters.status")}</label>
                <select id="status" name="status" defaultValue={status}>
                  <option value="open">{t("filters.open")}</option>
                  <option value="all">{t("filters.allStatuses")}</option>
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {tStatus(s)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {seeAll ? (
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="salesperson">{t("filters.salesperson")}</label>
                <select id="salesperson" name="salesperson" defaultValue={params.salesperson ?? ""}>
                  <option value="">{t("filters.everyone")}</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <button type="submit" className="btn-secondary">
              {t("filters.apply")}
            </button>
            <span className="row" style={{ gap: 6, marginInlineStart: "auto" }} role="group" aria-label={t("title")}>
              <Link className={view === "list" ? "btn-primary" : "btn-secondary"} href={query({ view: "list" })}>
                {t("views.list")}
              </Link>
              <Link className={view === "board" ? "btn-primary" : "btn-secondary"} href={query({ view: "board" })}>
                {t("views.board")}
              </Link>
            </span>
          </div>
        </form>

        {view === "board" ? (
          <div className="lead-board">
            {[...LEAD_FUNNEL, "LOST" as const].map((stage) => {
              const inStage = leads.filter((lead) => lead.status === stage);
              return (
                <section key={stage} className="lead-column" aria-label={tStatus(stage)}>
                  <h2 className="section-title">
                    {tStatus(stage)} <span className="muted">· {inStage.length}</span>
                  </h2>
                  {inStage.length === 0 ? (
                    <p className="muted" style={{ fontSize: 12.5 }}>
                      {t("emptyColumn")}
                    </p>
                  ) : (
                    inStage.map((lead) => (
                      <Link key={lead.id} href={`/leads/${lead.id}`} className="lead-card">
                        <strong>
                          <bdi>{lead.name}</bdi>
                        </strong>
                        <span className="muted">
                          <bdi>{lead.code}</bdi>
                          {lead.interestedVehicle
                            ? ` · ${lead.interestedVehicle.make} ${lead.interestedVehicle.model}`
                            : ""}
                        </span>
                        {seeAll && lead.salesperson ? (
                          <span className="muted">{lead.salesperson.fullName}</span>
                        ) : null}
                      </Link>
                    ))
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="card">
            {leads.length === 0 ? (
              <div className="card-body">
                <p className="muted">{q || status !== "open" || params.salesperson ? t("emptyFiltered") : t("empty")}</p>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t("columns.code")}</th>
                      <th>{t("columns.name")}</th>
                      <th>{t("columns.mobile")}</th>
                      <th>{t("columns.source")}</th>
                      <th>{t("columns.interest")}</th>
                      {seeAll ? <th>{t("columns.salesperson")}</th> : null}
                      <th>{t("columns.status")}</th>
                      <th>{t("columns.updated")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead) => (
                      <tr key={lead.id}>
                        <td>
                          <Link href={`/leads/${lead.id}`}>
                            <bdi>{lead.code}</bdi>
                          </Link>
                        </td>
                        <td style={{ fontWeight: 560 }}>
                          <bdi>{lead.name}</bdi>
                        </td>
                        <td className="muted">
                          <bdi>{lead.mobile}</bdi>
                        </td>
                        <td className="muted">{tSources(lead.source)}</td>
                        <td className="muted">
                          {lead.interestedVehicle ? `${lead.interestedVehicle.make} ${lead.interestedVehicle.model}` : "—"}
                        </td>
                        {seeAll ? <td className="muted">{lead.salesperson?.fullName ?? "—"}</td> : null}
                        <td>
                          <span className={`badge ${leadStatusTone(lead.status)}`.trim()}>{tStatus(lead.status)}</span>
                        </td>
                        <td className="muted" style={{ whiteSpace: "nowrap" }}>
                          {format.dateTime(lead.updatedAt, { dateStyle: "medium" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
