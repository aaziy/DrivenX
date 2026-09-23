import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { excessMileageCharge, formatFuelEighths, fuelShortfallEighths, Money } from "@drivenx/core";
import { handoversForContract, prisma, type HandoverType } from "@drivenx/db";

import { DocumentsCard } from "../../documents/documents-card";
import {
  addDamagePointAction,
  discardHandoverAction,
  recordHandoverAction,
  removeDamagePointAction,
  signHandoverAction,
} from "../actions";
import { ActionButton } from "./panels";
import { AddDamageForm, HandoverForm, SignHandoverForm } from "./handover-panels";
import { VehicleDiagram } from "@/components/vehicle-diagram";

/**
 * The car going out and coming back (P2-01 – P2-04, SOW §12).
 *
 * The two forms are shown side by side on purpose. The return is only meaningful read
 * against the handover — the difference in the odometer and in the marks on the body is
 * what the final settlement charges for — so the page puts them where they can be
 * compared rather than on separate screens.
 */
export async function HandoverCard({
  contractId,
  customerName,
  staffName,
  odometerKm,
  mileageAllowanceKm,
  excessMileageRateFils,
  canManage,
  canSeeDocuments,
  canUpload,
  canDelete,
}: {
  contractId: string;
  customerName: string;
  staffName: string;
  odometerKm: number;
  mileageAllowanceKm: number | null;
  excessMileageRateFils: bigint | null;
  canManage: boolean;
  canSeeDocuments: boolean;
  canUpload: boolean;
  canDelete: boolean;
}) {
  const [t, format, handovers] = await Promise.all([
    getTranslations("handovers"),
    getFormatter(),
    handoversForContract(contractId),
  ]);

  // Which records already carry photographs. A signed form with none should not show an
  // empty upload card, and three of them stacked is what the damage list turns into.
  const photographed = new Set(
    (
      await prisma.document.groupBy({
        by: ["ownerId"],
        where: {
          deletedAt: null,
          ownerType: { in: ["HANDOVER", "DAMAGE_POINT"] },
          ownerId: {
            in: [...handovers.map((row) => row.id), ...handovers.flatMap((row) => row.damagePoints.map((p) => p.id))],
          },
        },
        _count: { _all: true },
      })
    ).map((group) => group.ownerId),
  );

  const at = (date: Date) => format.dateTime(date, { dateStyle: "medium", timeStyle: "short" });
  const find = (type: HandoverType) => handovers.find((row) => row.type === type);
  const out = find("HANDOVER");
  const back = find("RETURN");

  // A datetime-local field takes the reader's wall clock, not an ISO instant.
  const now = new Date();
  const nowLocal = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

  const excess =
    out?.status === "SIGNED" && back?.status === "SIGNED"
      ? excessMileageCharge({
          handoverKm: out.odometerKm,
          returnKm: back.odometerKm,
          allowanceKm: mileageAllowanceKm,
          rateFils: excessMileageRateFils,
        })
      : null;

  const fuelShort = out && back ? fuelShortfallEighths(out.fuelEighths, back.fuelEighths) : 0;

  function section(type: HandoverType, record: (typeof handovers)[number] | undefined) {
    const title = t(type === "HANDOVER" ? "handoverTitle" : "returnTitle");

    if (!record) {
      // A return cannot be written before the car went out; the form says so rather than
      // failing after everything has been filled in.
      const blocked = type === "RETURN" && !out;
      return (
        <div>
          <h3 className="section-title">{title}</h3>
          {blocked ? (
            <p className="muted">{t("returnNeedsHandover")}</p>
          ) : canManage ? (
            <HandoverForm
              action={recordHandoverAction.bind(null, contractId)}
              type={type}
              odometerKm={type === "RETURN" ? (out?.odometerKm ?? odometerKm) : odometerKm}
              nowLocal={nowLocal}
            />
          ) : (
            <p className="muted">{t("none")}</p>
          )}
        </div>
      );
    }

    const signed = record.status === "SIGNED";

    return (
      <div>
        <div className="card-header" style={{ paddingInline: 0 }}>
          <h3 className="section-title">{title}</h3>
          <span className={signed ? "badge badge-success" : "badge badge-warning"}>
            {t(signed ? "status.SIGNED" : "status.DRAFT")}
          </span>
        </div>

        <table className="deal-table">
          <tbody>
            <tr>
              <td>{t("form.occurredAt")}</td>
              <td>{at(record.occurredAt)}</td>
            </tr>
            <tr>
              <td>{t("form.odometer")}</td>
              <td className="numeric">{t("km", { km: record.odometerKm })}</td>
            </tr>
            <tr>
              <td>{t("form.fuel")}</td>
              <td className="numeric">{formatFuelEighths(record.fuelEighths)}</td>
            </tr>
            {record.conditionNotes ? (
              <tr>
                <td>{t("form.condition")}</td>
                <td>{record.conditionNotes}</td>
              </tr>
            ) : null}
            {signed ? (
              <tr>
                <td>{t("sign.signedBy")}</td>
                <td>
                  {record.customerSignatureName} · {record.staffSignatureName}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <p className="field-label" style={{ marginTop: 12 }}>
          {t("damage.title")}
        </p>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          {/* The picture is the record. A list of panel names alone is what the diagram
              was built to replace. */}
          <VehicleDiagram marks={record.damagePoints} label={t("damage.recordLabel")} />
          <div style={{ flex: "1 1 200px", minWidth: 200 }}>
            {record.damagePoints.length === 0 ? (
              <p className="muted">{t("damage.none")}</p>
            ) : (
              /* Numbered by the list itself, so the numbers match the circles. */
              <ol style={{ paddingInlineStart: 20, margin: 0 }}>
                {record.damagePoints.map((point) => (
                  <li key={point.id} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span>
                        {t(`panels.${point.panel}`)} · {t(`severity.${point.severity}`)}
                        {point.note ? ` — ${point.note}` : ""}
                      </span>
                      {!signed && canManage ? (
                        <ActionButton
                          action={removeDamagePointAction.bind(null, contractId, point.id)}
                          label={t("damage.remove")}
                          pendingLabel={t("saving")}
                          variant="secondary"
                        />
                      ) : null}
                    </div>
                    {canSeeDocuments && (!signed || photographed.has(point.id)) ? (
                      /* Photographs of this one mark, through the same document engine as
                         every other file (PROJECT_PLAN.md §3.3). */
                      <DocumentsCard
                        ownerType="DAMAGE_POINT"
                        ownerId={point.id}
                        canUpload={canUpload && !signed}
                        canDelete={canDelete && !signed}
                      />
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        {!signed && canManage ? (
          <>
            <div className="form-section">
              <p className="field-label">{t("damage.addTitle")}</p>
              <AddDamageForm
                action={addDamagePointAction.bind(null, contractId, record.id)}
                marks={record.damagePoints}
              />
            </div>
            <div className="form-section">
              <p className="field-label">{t("sign.title")}</p>
              <SignHandoverForm
                action={signHandoverAction.bind(null, contractId, record.id)}
                customerName={customerName}
                staffName={staffName}
              />
            </div>
            <ActionButton
              action={discardHandoverAction.bind(null, contractId, record.id)}
              label={t("discard")}
              pendingLabel={t("saving")}
              variant="secondary"
            />
          </>
        ) : null}

        {signed ? (
          <p style={{ marginTop: 12 }}>
            <Link className="btn-secondary" href={`/contracts/${contractId}/handover/${record.id}/pdf`}>
              {t("printReport")}
            </Link>
          </p>
        ) : null}

        {canSeeDocuments && (!signed || photographed.has(record.id)) ? (
          <DocumentsCard
            ownerType="HANDOVER"
            ownerId={record.id}
            canUpload={canUpload && !signed}
            canDelete={canDelete && !signed}
          />
        ) : null}
      </div>
    );
  }

  return (
    <section className="card">
      <div className="card-header">
        <h2>{t("cardTitle")}</h2>
      </div>
      <div className="card-body">
        <p className="field-hint">{t("hint")}</p>

        {excess ? (
          <table className="deal-table">
            <tbody>
              <tr>
                <td>{t("excess.travelled")}</td>
                <td className="numeric">{t("km", { km: excess.travelledKm })}</td>
              </tr>
              <tr>
                <td>{t("excess.allowance")}</td>
                <td className="numeric">
                  {excess.allowanceKm === null ? t("excess.unlimited") : t("km", { km: excess.allowanceKm })}
                </td>
              </tr>
              <tr className={excess.chargeable ? "deal-total" : ""}>
                <td>{t("excess.over")}</td>
                <td className="numeric">{t("km", { km: excess.excessKm })}</td>
              </tr>
              {excess.chargeable ? (
                <tr className="deal-profit">
                  <td>{t("excess.charge")}</td>
                  <td className="numeric">{Money.format(excess.netFils, { currency: null })}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : null}

        {excess?.chargeable ? <p className="field-hint">{t("excess.hint")}</p> : null}
        {fuelShort > 0 ? (
          <p className="field-hint">{t("excess.fuelShort", { eighths: fuelShort })}</p>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
          {section("HANDOVER", out)}
          {section("RETURN", back)}
        </div>
      </div>
    </section>
  );
}
