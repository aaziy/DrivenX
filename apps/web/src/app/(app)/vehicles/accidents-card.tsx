import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { businessDate, Money, netAccidentCost } from "@drivenx/core";
import { accidentsForVehicle, prisma } from "@drivenx/db";

import { DocumentsCard } from "../documents/documents-card";
import {
  lodgeClaimAction,
  recordAccidentAction,
  recordRepairAction,
  transitionAccidentAction,
  transitionClaimAction,
} from "./actions";
import { AccidentForm, ClaimForm, RepairForm, StatusMoveForm } from "./accidents-panels";

/**
 * Crashes, repairs and claims (P2-09, P2-10, SOW §13).
 *
 * Each crash leads with what it has actually cost DrivenX — the repair less whatever the
 * insurer has genuinely paid — because that is the number that reaches vehicle
 * profitability and the one anybody reading this page is trying to find. An approved
 * claim is shown as approved, never as money: insurers reduce and refuse, and a screen
 * that showed an approval as a recovery would be reporting cash that has not arrived.
 */
export async function AccidentsCard({
  vehicleId,
  canManage,
  canSeeDocuments,
  canUpload,
  canDelete,
}: {
  vehicleId: string;
  canManage: boolean;
  canSeeDocuments: boolean;
  canUpload: boolean;
  canDelete: boolean;
}) {
  const [t, format, accidents, policies] = await Promise.all([
    getTranslations("accidents"),
    getFormatter(),
    accidentsForVehicle(vehicleId),
    prisma.insurancePolicy.findMany({
      where: { vehicleId, deletedAt: null, cancelledAt: null },
      orderBy: { expiryDate: "desc" },
      select: { id: true, provider: true, policyNumber: true },
    }),
  ]);

  const today = businessDate(new Date());
  const day = (date: Date) => format.dateTime(date, { dateStyle: "medium", timeZone: "UTC" });
  const amount = (fils: bigint) => Money.format(fils, { currency: null });

  const policyOptions = policies.map((policy) => ({
    id: policy.id,
    label: `${policy.provider} · ${policy.policyNumber}`,
  }));

  const tone = (status: string) => {
    if (status === "WRITTEN_OFF") return "badge-danger";
    if (status === "UNDER_REPAIR" || status === "REPORTED") return "badge-warning";
    return "badge-success";
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2>{t("cardTitle")}</h2>
      </div>

      <div className="card-body">
        <p className="field-hint">{t("hint")}</p>

        {accidents.length === 0 ? <p className="muted">{t("none")}</p> : null}

        {accidents.map((accident) => {
          const claim = accident.claim;
          const repairNet = accident.repairNetFils ?? 0n;
          const received = claim?.receivedFils ?? 0n;
          const net = netAccidentCost(repairNet, received);

          return (
            <div key={accident.id} className="form-section">
              <div className="card-header" style={{ paddingInline: 0 }}>
                <h3 className="section-title">
                  {day(accident.occurredOn)} · {accident.location}
                </h3>
                <span className={`badge ${tone(accident.status)}`}>{t(`status.${accident.status}`)}</span>
              </div>

              <table className="deal-table">
                <tbody>
                  <tr>
                    <td>{t("form.responsibility")}</td>
                    <td>{t(`responsibilities.${accident.responsibility}`)}</td>
                  </tr>
                  {accident.customer ? (
                    <tr>
                      <td>{t("driver")}</td>
                      <td>
                        <Link href={`/customers/${accident.customer.id}`}>{accident.customer.fullName}</Link>
                        {accident.contract ? (
                          <>
                            {" · "}
                            <Link className="muted" href={`/contracts/${accident.contract.id}`}>
                              {accident.contract.number}
                            </Link>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                  {accident.policeReportNumber ? (
                    <tr>
                      <td>{t("form.policeReport")}</td>
                      <td>{accident.policeReportNumber}</td>
                    </tr>
                  ) : null}
                  {accident.description ? (
                    <tr>
                      <td>{t("form.description")}</td>
                      <td>{accident.description}</td>
                    </tr>
                  ) : null}
                  {accident.repairFils !== null ? (
                    <tr>
                      <td>{t("repair")}</td>
                      <td className="numeric">
                        {amount(repairNet)}
                        <span className="muted">
                          {" · "}
                          {accident.repairVendor}
                          {accident.repairedOn ? ` · ${day(accident.repairedOn)}` : ""}
                        </span>
                      </td>
                    </tr>
                  ) : null}
                  {claim ? (
                    <tr>
                      <td>{t("claim")}</td>
                      <td>
                        <span className="badge">{t(`claimStatus.${claim.status}`)}</span>{" "}
                        <span className="muted">{claim.claimNumber}</span>
                        <br />
                        <span className="muted">
                          {t("claimedAmount", { amount: amount(claim.claimedFils) })}
                          {claim.approvedFils !== null
                            ? ` · ${t("approvedAmount", { amount: amount(claim.approvedFils) })}`
                            : ""}
                          {claim.receivedFils !== null
                            ? ` · ${t("receivedAmount", { amount: amount(claim.receivedFils) })}`
                            : ""}
                        </span>
                      </td>
                    </tr>
                  ) : null}
                  {accident.repairFils !== null ? (
                    <tr className="deal-profit">
                      <td>{t("netCost")}</td>
                      <td className="numeric">{amount(net)}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>

              {canManage ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {accident.status === "REPORTED" ? (
                    <StatusMoveForm
                      action={transitionAccidentAction.bind(null, vehicleId, accident.id, "UNDER_REPAIR")}
                      label={t("actions.sendToGarage")}
                      today={today}
                    />
                  ) : null}
                  {accident.status === "UNDER_REPAIR" ? (
                    <StatusMoveForm
                      action={transitionAccidentAction.bind(null, vehicleId, accident.id, "REPAIRED")}
                      label={t("actions.backOnTheRoad")}
                      today={today}
                      variant="primary"
                    />
                  ) : null}
                  {accident.status === "REPORTED" || accident.status === "UNDER_REPAIR" ? (
                    <StatusMoveForm
                      action={transitionAccidentAction.bind(null, vehicleId, accident.id, "WRITTEN_OFF")}
                      label={t("actions.writeOff")}
                      today={today}
                      ask="reason"
                    />
                  ) : null}
                  {accident.status === "REPAIRED" || accident.status === "WRITTEN_OFF" ? (
                    <StatusMoveForm
                      action={transitionAccidentAction.bind(null, vehicleId, accident.id, "CLOSED")}
                      label={t("actions.close")}
                      today={today}
                    />
                  ) : null}
                </div>
              ) : null}

              {canManage && accident.repairFils === null ? (
                <div style={{ marginTop: 12 }}>
                  <p className="field-label">{t("recordRepairTitle")}</p>
                  <RepairForm action={recordRepairAction.bind(null, vehicleId, accident.id)} today={today} />
                </div>
              ) : null}

              {canManage && !claim ? (
                <div style={{ marginTop: 12 }}>
                  <p className="field-label">{t("lodgeClaimTitle")}</p>
                  <ClaimForm
                    action={lodgeClaimAction.bind(null, vehicleId, accident.id)}
                    today={today}
                    policies={policyOptions}
                    noPolicyLabel={t("form.noPolicy")}
                  />
                </div>
              ) : null}

              {canManage && claim ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {claim.status === "LODGED" ? (
                    <>
                      <StatusMoveForm
                        action={transitionClaimAction.bind(null, vehicleId, claim.id, "APPROVED")}
                        label={t("actions.approve")}
                        today={today}
                        ask="approved"
                      />
                      <StatusMoveForm
                        action={transitionClaimAction.bind(null, vehicleId, claim.id, "REJECTED")}
                        label={t("actions.reject")}
                        today={today}
                        ask="reason"
                      />
                    </>
                  ) : null}
                  {claim.status === "APPROVED" ? (
                    <StatusMoveForm
                      action={transitionClaimAction.bind(null, vehicleId, claim.id, "SETTLED")}
                      label={t("actions.settle")}
                      today={today}
                      ask="received"
                      variant="primary"
                    />
                  ) : null}
                  {claim.status === "REJECTED" || claim.status === "WITHDRAWN" ? (
                    <StatusMoveForm
                      action={transitionClaimAction.bind(null, vehicleId, claim.id, "LODGED")}
                      label={t("actions.appeal")}
                      today={today}
                    />
                  ) : null}
                </div>
              ) : null}

              {canSeeDocuments ? (
                <DocumentsCard
                  ownerType="ACCIDENT"
                  ownerId={accident.id}
                  canUpload={canUpload && canManage}
                  canDelete={canDelete && canManage}
                />
              ) : null}
            </div>
          );
        })}

        {canManage ? (
          <div className="form-section">
            <p className="field-label">{t("addTitle")}</p>
            <AccidentForm action={recordAccidentAction.bind(null, vehicleId)} today={today} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
