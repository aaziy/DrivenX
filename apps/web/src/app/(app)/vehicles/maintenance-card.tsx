import { getFormatter, getTranslations } from "next-intl/server";

import { businessDate, Money, serviceDue } from "@drivenx/core";
import { fromDbDate, prisma } from "@drivenx/db";

import { recordMaintenanceAction } from "./actions";
import { MaintenanceForm } from "./maintenance-panels";

/**
 * What this car has cost to keep on the road, and when it is next due (P2-05, P2-06).
 *
 * The heading answers the question staff actually have — is this car due? — from the
 * latest record's markers against today's odometer, which is the same rule the nightly
 * check uses.
 */
export async function MaintenanceCard({
  vehicleId,
  odometerKm,
  canManage,
}: {
  vehicleId: string;
  odometerKm: number;
  canManage: boolean;
}) {
  const today = businessDate(new Date());
  const [t, format, records] = await Promise.all([
    getTranslations("maintenance"),
    getFormatter(),
    prisma.maintenanceRecord.findMany({
      where: { vehicleId, deletedAt: null },
      orderBy: [{ servicedOn: "desc" }, { createdAt: "desc" }],
      take: 20,
    }),
  ]);

  const day = (date: Date) => format.dateTime(date, { dateStyle: "medium", timeZone: "UTC" });
  const latest = records[0];
  const due = latest
    ? serviceDue(
        {
          nextServiceOn: latest.nextServiceOn ? fromDbDate(latest.nextServiceOn) : null,
          nextServiceKm: latest.nextServiceKm,
        },
        { today, odometerKm },
      )
    : null;

  const heading = () => {
    if (!latest || !due) return null;
    const byMileage =
      due.kmRemaining !== null && (due.daysRemaining === null || due.kmRemaining <= due.daysRemaining * 100);
    if (due.overdue) {
      return byMileage
        ? t("overdueKm", { km: Math.abs(due.kmRemaining ?? 0) })
        : t("overdueDate", { date: latest.nextServiceOn ? day(latest.nextServiceOn) : "" });
    }
    if (due.dueSoon) {
      return byMileage
        ? t("dueSoonKm", { km: due.kmRemaining ?? 0 })
        : t("dueSoonDate", { date: latest.nextServiceOn ? day(latest.nextServiceOn) : "" });
    }
    return latest.nextServiceOn ? t("nextOk", { date: day(latest.nextServiceOn) }) : null;
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>{t("cardTitle")}</h2>
        {due ? (
          <span className={due.overdue ? "badge badge-danger" : due.dueSoon ? "badge badge-warning" : "muted"}>
            {heading()}
          </span>
        ) : null}
      </div>

      {records.length === 0 ? (
        <div className="card-body">
          <p className="muted">{t("none")}</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="data">
            <thead>
              <tr>
                <th>{t("columns.date")}</th>
                <th>{t("columns.type")}</th>
                <th>{t("columns.vendor")}</th>
                <th className="numeric">{t("columns.odometer")}</th>
                <th className="numeric">{t("columns.cost")}</th>
                <th>{t("columns.next")}</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{day(record.servicedOn)}</td>
                  <td>{t(`types.${record.type}`)}</td>
                  <td className="muted">
                    <bdi>
                      {record.vendor}
                      {record.vendorInvoiceNumber ? ` · ${record.vendorInvoiceNumber}` : ""}
                    </bdi>
                    {record.description ? (
                      <div className="muted" style={{ fontSize: 12 }}>
                        <bdi>{record.description}</bdi>
                      </div>
                    ) : null}
                  </td>
                  <td className="numeric" style={{ whiteSpace: "nowrap" }}>
                    {t("km", { km: record.odometerKm })}
                  </td>
                  <td className="numeric" style={{ whiteSpace: "nowrap" }}>
                    {Money.format(record.costFils, { currency: null })}
                  </td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>
                    {[
                      record.nextServiceOn ? day(record.nextServiceOn) : null,
                      record.nextServiceKm ? t("km", { km: record.nextServiceKm }) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || t("noNext")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage ? (
        <div className="card-body" style={{ borderTop: records.length > 0 ? "1px solid var(--border)" : undefined }}>
          <p className="muted">{t("hint")}</p>
          <MaintenanceForm
            action={recordMaintenanceAction.bind(null, vehicleId)}
            today={today}
            odometerKm={odometerKm}
          />
        </div>
      ) : null}
    </div>
  );
}
