import { getFormatter, getTranslations } from "next-intl/server";

import { businessDate, Money } from "@drivenx/core";
import { policyState, prisma } from "@drivenx/db";

import { addPolicyAction, cancelPolicyAction } from "./actions";
import { CancelPolicyForm, PolicyForm } from "./insurance-panels";

/**
 * The cover on one car (P1D-10 – P1D-12): what the insurer charges DrivenX, against the
 * insurance charged to the customer on the contract. Without this, insurance reports as
 * pure profit.
 */
export async function InsuranceCard({
  vehicleId,
  canManage,
}: {
  vehicleId: string;
  canManage: boolean;
}) {
  const today = businessDate(new Date());
  const [t, format, policies] = await Promise.all([
    getTranslations("insurance"),
    getFormatter(),
    prisma.insurancePolicy.findMany({
      where: { vehicleId, deletedAt: null },
      orderBy: { expiryDate: "desc" },
    }),
  ]);

  const day = (date: Date) => format.dateTime(date, { dateStyle: "medium", timeZone: "UTC" });
  const tone = { ACTIVE: "badge-success", EXPIRED: "badge-danger", CANCELLED: "" } as const;

  return (
    <div className="card">
      <div className="card-header">
        <h2>{t("cardTitle")}</h2>
        {policies.length > 0 ? (
          <span className="muted">
            {(() => {
              const current = policies.find((policy) => policyState(policy, today).status === "ACTIVE");
              if (current) {
                const { daysToExpiry } = policyState(current, today);
                return daysToExpiry <= 30
                  ? t("expiringSoon", { days: daysToExpiry })
                  : t("inForce", { date: day(current.expiryDate) });
              }
              // "Lapsed" is about cover running out. A cancelled policy did not lapse, and
              // saying so would misreport why the car is uninsured.
              const expired = policies.find((policy) => policyState(policy, today).status === "EXPIRED");
              return expired ? t("lapsed", { date: day(expired.expiryDate) }) : t("noneInForce");
            })()}
          </span>
        ) : null}
      </div>

      {policies.length === 0 ? (
        <div className="card-body">
          <p className="muted">{t("none")}</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="data">
            <thead>
              <tr>
                <th>{t("columns.provider")}</th>
                <th>{t("columns.policyNumber")}</th>
                <th>{t("columns.coverage")}</th>
                <th>{t("columns.period")}</th>
                <th className="numeric">{t("columns.premium")}</th>
                <th>{t("columns.status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => {
                const state = policyState(policy, today);
                return (
                  <tr key={policy.id}>
                    <td style={{ fontWeight: 560 }}>
                      <bdi>{policy.provider}</bdi>
                    </td>
                    <td className="muted">
                      <bdi>{policy.policyNumber}</bdi>
                    </td>
                    <td className="muted">{t(`coverage.${policy.coverage}`)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {day(policy.startDate)} – {day(policy.expiryDate)}
                    </td>
                    <td className="numeric" style={{ whiteSpace: "nowrap" }}>
                      {Money.format(policy.premiumFils, { currency: null })}
                    </td>
                    <td>
                      <span className={`badge ${tone[state.status]}`.trim()}>{t(`status.${state.status}`)}</span>
                      {policy.cancelReason ? (
                        <div className="muted" style={{ fontSize: 12 }}>
                          <bdi>{policy.cancelReason}</bdi>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {canManage && state.status === "ACTIVE" ? (
                        <CancelPolicyForm action={cancelPolicyAction.bind(null, vehicleId, policy.id)} />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canManage ? (
        <div className="card-body" style={{ borderTop: policies.length > 0 ? "1px solid var(--border)" : undefined }}>
          <p className="muted">{t("hint")}</p>
          <PolicyForm action={addPolicyAction.bind(null, vehicleId)} today={today} />
        </div>
      ) : null}
    </div>
  );
}
