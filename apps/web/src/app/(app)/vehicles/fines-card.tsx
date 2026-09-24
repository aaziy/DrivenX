import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { businessDate, Money } from "@drivenx/core";
import { finesForVehicle } from "@drivenx/db";

import { recordFineAction, recoverFineAction, transitionFineAction } from "./actions";
import { FineActionForm, FineForm } from "./fines-panels";

/**
 * Traffic fines against this car (P2-07, P2-08, SOW §13).
 *
 * The controls on each row are the states the fine can actually reach from where it is,
 * taken from the machine in `core/fines/status.ts` rather than listed here — a screen
 * offering a move the service will refuse is a screen that teaches staff to distrust it.
 *
 * What the row leads with is whether DrivenX is out of pocket, because that is the
 * question operations is actually working through: a fine sitting at Paid is money that
 * has left and not come back.
 */
export async function FinesCard({ vehicleId, canManage }: { vehicleId: string; canManage: boolean }) {
  const [t, format, fines] = await Promise.all([
    getTranslations("fines"),
    getFormatter(),
    finesForVehicle(vehicleId),
  ]);

  const today = businessDate(new Date());
  const day = (date: Date) => format.dateTime(date, { dateStyle: "medium", timeZone: "UTC" });

  const tone = (status: string) => {
    if (status === "PAID") return "badge-warning";
    if (status === "RECOVERED" || status === "PAID_BY_CUSTOMER" || status === "CANCELLED") return "badge-success";
    if (status === "WAIVED") return "badge-danger";
    return "";
  };

  // What DrivenX has paid out and not recovered — the figure worth showing at the top.
  const outOfPocket = fines
    .filter((fine) => fine.status === "PAID")
    .reduce((total, fine) => total + fine.amountFils, 0n);

  return (
    <section className="card">
      <div className="card-header">
        <h2>{t("cardTitle")}</h2>
        {outOfPocket > 0n ? (
          <span className="badge badge-warning">
            {t("outOfPocket", { amount: Money.format(outOfPocket, { currency: null }) })}
          </span>
        ) : null}
      </div>

      <div className="card-body">
        <p className="field-hint">{t("hint")}</p>

        {fines.length === 0 ? (
          <p className="muted">{t("none")}</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>{t("columns.occurredOn")}</th>
                  <th>{t("columns.fine")}</th>
                  <th>{t("columns.driver")}</th>
                  <th className="numeric">{t("columns.amount")}</th>
                  <th>{t("columns.status")}</th>
                  {canManage ? <th>{t("columns.next")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {fines.map((fine) => (
                  <tr key={fine.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{day(fine.occurredOn)}</td>
                    <td>
                      {fine.authority}
                      <br />
                      <span className="muted">{fine.fineNumber}</span>
                    </td>
                    <td>
                      {fine.customer ? (
                        <Link href={`/customers/${fine.customer.id}`}>{fine.customer.fullName}</Link>
                      ) : (
                        <span className="muted">{t("payers.COMPANY")}</span>
                      )}
                      {fine.contract ? (
                        <>
                          <br />
                          <Link className="muted" href={`/contracts/${fine.contract.id}`}>
                            {fine.contract.number}
                          </Link>
                        </>
                      ) : null}
                    </td>
                    <td className="numeric">{Money.format(fine.amountFils, { currency: null })}</td>
                    <td>
                      <span className={`badge ${tone(fine.status)}`}>{t(`status.${fine.status}`)}</span>
                      {fine.recoveryInstallment?.invoiceNumber ? (
                        <>
                          <br />
                          <span className="muted">{fine.recoveryInstallment.invoiceNumber}</span>
                        </>
                      ) : null}
                    </td>
                    {canManage ? (
                      <td>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {(fine.status === "OPEN" || fine.status === "DISPUTED") ? (
                            <>
                              <FineActionForm
                                action={transitionFineAction.bind(null, vehicleId, fine.id, "PAID")}
                                label={t("actions.pay")}
                                today={today}
                                askPaidOn
                                variant="primary"
                              />
                              <FineActionForm
                                action={transitionFineAction.bind(null, vehicleId, fine.id, "PAID_BY_CUSTOMER")}
                                label={t("actions.paidByCustomer")}
                                today={today}
                              />
                              {fine.status === "OPEN" ? (
                                <FineActionForm
                                  action={transitionFineAction.bind(null, vehicleId, fine.id, "DISPUTED")}
                                  label={t("actions.dispute")}
                                  today={today}
                                />
                              ) : null}
                              <FineActionForm
                                action={transitionFineAction.bind(null, vehicleId, fine.id, "CANCELLED")}
                                label={t("actions.cancel")}
                                today={today}
                                askReason
                              />
                            </>
                          ) : null}

                          {fine.status === "PAID" ? (
                            <>
                              {/* Only offered when there is someone to recharge: a fine
                                  from a day the car was in the yard has nobody. */}
                              {fine.customerId ? (
                                <FineActionForm
                                  action={recoverFineAction.bind(null, vehicleId, fine.id)}
                                  label={t("actions.recover")}
                                  today={today}
                                  variant="primary"
                                />
                              ) : null}
                              <FineActionForm
                                action={transitionFineAction.bind(null, vehicleId, fine.id, "WAIVED")}
                                label={t("actions.waive")}
                                today={today}
                                askReason
                              />
                            </>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canManage ? (
          <div className="form-section">
            <p className="field-label">{t("addTitle")}</p>
            <FineForm action={recordFineAction.bind(null, vehicleId)} today={today} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
