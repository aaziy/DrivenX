import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { can } from "@drivenx/auth";
import { businessDate, isOpenLead, manualLeadTransitions, Money, type LeadStatus } from "@drivenx/core";
import { prisma } from "@drivenx/db";

import { requirePermission } from "@/lib/auth";
import { leadWhere, offerableVehicles, salespeople } from "@/lib/leads";

import { changeLeadStatusAction, convertLeadAction, saveQuoteAction, updateLeadAction } from "../actions";
import { LeadForm } from "../lead-form";
import { leadStatusTone } from "../tone";
import { ConvertForm, QuoteForm, StatusForm } from "./panels";

export async function generateMetadata({ params }: { params: Promise<{ leadId: string }> }): Promise<Metadata> {
  const lead = await prisma.lead.findFirst({ where: { id: (await params).leadId }, select: { code: true } });
  return { title: lead ? `${lead.code} · DrivenX` : "DrivenX" };
}

export default async function LeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const principal = await requirePermission("lead.view");
  const { leadId } = await params;

  // Out of scope is not found: a salesperson learns nothing about a colleague's lead.
  const lead = await prisma.lead.findFirst({
    where: { ...leadWhere(principal), id: leadId },
    include: {
      salesperson: { select: { id: true, fullName: true } },
      interestedVehicle: { select: { id: true, make: true, model: true, plateCode: true, plateNumber: true } },
      contract: { select: { id: true, number: true } },
      quotes: { orderBy: { createdAt: "desc" }, include: { vehicle: { select: { make: true, model: true, code: true } } } },
      statusChanges: { orderBy: { changedAt: "desc" }, include: { changedBy: { select: { fullName: true } } } },
    },
  });
  if (!lead) notFound();

  const canUpdate = can(principal, "lead.update");
  const canQuote = canUpdate && can(principal, "deal.calculate") && isOpenLead(lead.status);
  const canConvert = lead.status === "DEAL_CREATED" && can(principal, "lead.convert") && can(principal, "contract.create");
  const canAssign = can(principal, "lead.view_all");

  const [t, tStatus, tSources, tTypes, format, vehicles, people] = await Promise.all([
    getTranslations("leads"),
    getTranslations("leads.status"),
    getTranslations("leads.sources"),
    getTranslations("contracts.types"),
    getFormatter(),
    canQuote || canUpdate ? offerableVehicles() : [],
    canUpdate && canAssign ? salespeople() : null,
  ]);

  const moves = manualLeadTransitions(lead.status as LeadStatus);
  const latest = lead.quotes[0];

  return (
    <>
      <header className="page-header">
        <div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            <Link href="/leads">{t("detail.back")}</Link>
          </p>
          <h1>
            <bdi>{lead.name}</bdi>{" "}
            <span className={`badge ${leadStatusTone(lead.status)}`.trim()} style={{ verticalAlign: "middle" }}>
              {tStatus(lead.status)}
            </span>
          </h1>
          <p className="page-subtitle">
            <bdi>{lead.code}</bdi> · <bdi>{lead.mobile}</bdi> · {tSources(lead.source)}
            {lead.salesperson ? ` · ${lead.salesperson.fullName}` : ""}
          </p>
        </div>
      </header>

      <div className="page-body stack">
        {lead.contract ? (
          <div className="card">
            <div className="card-header">
              <h2>{t("detail.contractedTitle")}</h2>
            </div>
            <div className="card-body row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <p style={{ margin: 0 }}>{t("detail.contractedBody", { number: lead.contract.number })}</p>
              <Link className="btn-secondary" href={`/contracts/${lead.contract.id}`}>
                {t("detail.openContract")}
              </Link>
            </div>
          </div>
        ) : null}

        <div className="card">
          <div className="card-header">
            <h2>{t("detail.pipelineTitle")}</h2>
          </div>
          <div className="card-body stack" style={{ gap: 10 }}>
            {lead.status === "LOST" && lead.lostReason ? (
              <p style={{ margin: 0 }}>
                <span className="muted">{t("detail.lostReasonLabel")}:</span> <bdi>{lead.lostReason}</bdi>
              </p>
            ) : null}
            {canUpdate && moves.length > 0 ? (
              <StatusForm
                action={changeLeadStatusAction.bind(null, lead.id)}
                options={moves.map((value) => ({ value, label: tStatus(value) }))}
              />
            ) : null}
            {isOpenLead(lead.status) ? (
              <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                {t("detail.earnedHint")}
              </p>
            ) : null}
          </div>
        </div>

        {canConvert && latest ? (
          <div className="card">
            <div className="card-header">
              <h2>{t("detail.convertTitle")}</h2>
            </div>
            <div className="card-body">
              <p className="muted">
                {t("detail.convertHint", { salesperson: lead.salesperson?.fullName ?? principal.fullName })}
              </p>
              <ConvertForm action={convertLeadAction.bind(null, lead.id)} today={businessDate(new Date())} />
            </div>
          </div>
        ) : null}

        <div className="card">
          <div className="card-header">
            <h2>{t("detail.quotesTitle")}</h2>
          </div>
          {lead.quotes.length === 0 ? (
            <div className="card-body">
              <p className="muted">{t("detail.noQuotes")}</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data">
                <tbody>
                  {lead.quotes.map((quote, index) => (
                    <tr key={quote.id}>
                      <td style={{ fontWeight: 560 }}>
                        <bdi>
                          {quote.vehicle.make} {quote.vehicle.model} ({quote.vehicle.code})
                        </bdi>
                      </td>
                      <td>
                        {t("detail.quoteLine", {
                          type: tTypes(quote.type),
                          months: quote.durationMonths,
                          monthly: Money.format(quote.monthlyRentalFils),
                        })}
                      </td>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>
                        {format.dateTime(quote.createdAt, { dateStyle: "medium" })}
                      </td>
                      <td>{index === 0 ? <span className="badge badge-success">{t("detail.latest")}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canQuote && vehicles.length > 0 ? (
            <div className="card-body" style={{ borderTop: "1px solid var(--border)" }}>
              <h3 className="form-section" style={{ marginTop: 0 }}>
                {t("detail.priceTitle")}
              </h3>
              <p className="muted">{t("detail.priceHint")}</p>
              <QuoteForm
                action={saveQuoteAction.bind(null, lead.id)}
                vehicles={vehicles}
                defaults={{
                  vehicleId: latest?.vehicleId ?? lead.interestedVehicleId ?? "",
                  durationMonths: String(latest?.durationMonths ?? lead.durationMonths ?? ""),
                  monthlyRental: latest
                    ? Money.toDecimalString(latest.monthlyRentalFils)
                    : lead.budgetFils !== null
                      ? Money.toDecimalString(lead.budgetFils)
                      : "",
                }}
              />
            </div>
          ) : null}
        </div>

        <div className="card">
          <div className="card-header">
            <h2>{t("detail.detailsTitle")}</h2>
          </div>
          <div className="card-body">
            {canUpdate ? (
              <LeadForm
                action={updateLeadAction.bind(null, lead.id)}
                vehicles={vehicles}
                salespeople={people}
                mode="edit"
                defaults={{
                  name: lead.name,
                  mobile: lead.mobile,
                  email: lead.email ?? "",
                  source: lead.source,
                  interestedVehicleId: lead.interestedVehicleId ?? "",
                  budget: lead.budgetFils !== null ? Money.toDecimalString(lead.budgetFils) : "",
                  durationMonths: lead.durationMonths !== null ? String(lead.durationMonths) : "",
                  notes: lead.notes ?? "",
                  salespersonId: lead.salespersonId ?? "",
                }}
              />
            ) : (
              <p className="muted">{t("detail.readOnly")}</p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>{t("detail.historyTitle")}</h2>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="data">
              <tbody>
                {lead.statusChanges.map((change) => (
                  <tr key={change.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {format.dateTime(change.changedAt, { dateStyle: "medium", timeStyle: "short" })}
                    </td>
                    <td style={{ fontWeight: 560 }}>
                      {change.fromStatus === null
                        ? t("detail.created")
                        : t("detail.changed", { from: tStatus(change.fromStatus), to: tStatus(change.toStatus) })}
                    </td>
                    <td className="muted">{change.note ? <bdi>{change.note}</bdi> : null}</td>
                    <td className="muted">
                      {change.changedBy ? t("detail.by", { name: change.changedBy.fullName }) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
