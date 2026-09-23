"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";

import { FUEL_EIGHTHS_MAX, OFF_DIAGRAM_PANELS, type DamageSeverity, type VehiclePanel } from "@drivenx/core";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";
import { SignaturePad } from "@/components/signature-pad";
import { VehicleDiagram, type DiagramMark } from "@/components/vehicle-diagram";

import type { ContractFormState } from "../actions";

const SEVERITIES: DamageSeverity[] = ["MINOR", "MODERATE", "SEVERE"];

const GRID = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: 12,
} as const;

/** A mark being made, before the form it belongs to exists. */
interface PendingMark extends DiagramMark {
  note: string;
}

let pendingSerial = 0;

/**
 * Filling the form in beside the car (P2-01 – P2-03).
 *
 * The marks are collected here and submitted with the readings in one go, because a
 * handover is written standing next to a car with a customer waiting: saving a header
 * first and then adding damage one round trip at a time is not a thing anyone does at a
 * kerbside on a phone. Once the form exists, marks are added and removed one at a time
 * against the server, where they can be photographed.
 */
export function HandoverForm({
  action,
  type,
  odometerKm,
  nowLocal,
}: {
  action: (state: ContractFormState, formData: FormData) => Promise<ContractFormState>;
  type: "HANDOVER" | "RETURN";
  odometerKm: number;
  /** `YYYY-MM-DDTHH:mm` in the reader's zone, for the datetime field's default. */
  nowLocal: string;
}) {
  const [state, formAction] = useActionState<ContractFormState, FormData>(action, {});
  const t = useTranslations("handovers");
  const [marks, setMarks] = useState<PendingMark[]>([]);
  const [severity, setSeverity] = useState<DamageSeverity>("MINOR");
  const [offPanel, setOffPanel] = useState<VehiclePanel>(OFF_DIAGRAM_PANELS[0] as VehiclePanel);

  function place(position: { x: number; y: number; panel: VehiclePanel }) {
    pendingSerial += 1;
    setMarks((current) => [
      ...current,
      {
        id: `pending-${pendingSerial}`,
        panel: position.panel,
        positionX: position.x,
        positionY: position.y,
        severity,
        note: "",
      },
    ]);
  }

  function addOffDiagram() {
    pendingSerial += 1;
    setMarks((current) => [
      ...current,
      { id: `pending-${pendingSerial}`, panel: offPanel, positionX: null, positionY: null, severity, note: "" },
    ]);
  }

  const remove = (id: string) => setMarks((current) => current.filter((mark) => mark.id !== id));
  const annotate = (id: string, note: string) =>
    setMarks((current) => current.map((mark) => (mark.id === id ? { ...mark, note } : mark)));

  return (
    <form action={formAction} noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <input type="hidden" name="type" value={type} />
      {/* The marks travel as JSON: the server re-derives every panel from its position
          anyway, so nothing here is trusted beyond the two coordinates. */}
      <input
        type="hidden"
        name="damagePoints"
        value={JSON.stringify(
          marks.map((mark) => ({
            panel: mark.panel,
            severity: mark.severity,
            positionX: mark.positionX,
            positionY: mark.positionY,
            note: mark.note,
          })),
        )}
      />

      <div style={GRID}>
        <Field label={t("form.occurredAt")} name="occurredAt" type="datetime-local" dir="ltr" required defaultValue={nowLocal} />
        <Field
          label={t("form.odometer")}
          name="odometerKm"
          type="number"
          dir="ltr"
          required
          defaultValue={String(odometerKm)}
        />
        <div className="field">
          <label htmlFor="fuelEighths">{t("form.fuel")}</label>
          <select id="fuelEighths" name="fuelEighths" defaultValue={String(FUEL_EIGHTHS_MAX)}>
            {Array.from({ length: FUEL_EIGHTHS_MAX + 1 }, (_, eighths) => (
              <option key={eighths} value={eighths}>
                {t("fuelReading", { eighths, max: FUEL_EIGHTHS_MAX })}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="conditionNotes">{t("form.condition")}</label>
        <input id="conditionNotes" name="conditionNotes" placeholder={t("form.conditionHint")} />
      </div>

      <div className="form-section">
        <p className="field-label">{t("damage.title")}</p>
        <p className="field-hint">{t("damage.hint")}</p>

        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <VehicleDiagram marks={marks} onPlace={place} label={t("damage.diagramLabel")} />

          <div style={{ flex: "1 1 260px", minWidth: 240 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="field" style={{ flex: "1 1 120px", marginBottom: 0 }}>
                <label htmlFor="markSeverity">{t("damage.severity")}</label>
                <select
                  id="markSeverity"
                  value={severity}
                  onChange={(event) => setSeverity(event.target.value as DamageSeverity)}
                >
                  {SEVERITIES.map((level) => (
                    <option key={level} value={level}>
                      {t(`severity.${level}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: "1 1 140px", marginBottom: 0 }}>
                <label htmlFor="offPanel">{t("damage.elsewhere")}</label>
                <select
                  id="offPanel"
                  value={offPanel}
                  onChange={(event) => setOffPanel(event.target.value as VehiclePanel)}
                >
                  {OFF_DIAGRAM_PANELS.map((panel) => (
                    <option key={panel} value={panel}>
                      {t(`panels.${panel}`)}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className="btn-secondary" onClick={addOffDiagram}>
                {t("damage.add")}
              </button>
            </div>

            {marks.length === 0 ? (
              <p className="muted" style={{ marginTop: 12 }}>
                {t("damage.none")}
              </p>
            ) : (
              <ol style={{ marginTop: 12, paddingInlineStart: 20 }}>
                {marks.map((mark) => (
                  <li key={mark.id} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span>
                        {t(`panels.${mark.panel}`)} · {t(`severity.${mark.severity}`)}
                      </span>
                      <button type="button" className="btn-link" onClick={() => remove(mark.id)}>
                        {t("damage.remove")}
                      </button>
                    </div>
                    <input
                      aria-label={t("damage.note")}
                      placeholder={t("damage.note")}
                      value={mark.note}
                      onChange={(event) => annotate(mark.id, event.target.value)}
                    />
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>

      <SubmitButton pendingLabel={t("saving")}>{t(type === "HANDOVER" ? "recordHandover" : "recordReturn")}</SubmitButton>
    </form>
  );
}

/**
 * Adding a mark to a form that already exists, so it can be photographed.
 */
export function AddDamageForm({
  action,
  marks,
}: {
  action: (state: ContractFormState, formData: FormData) => Promise<ContractFormState>;
  marks: DiagramMark[];
}) {
  const [state, formAction] = useActionState<ContractFormState, FormData>(action, {});
  const t = useTranslations("handovers");
  const [placed, setPlaced] = useState<{ x: number; y: number; panel: VehiclePanel } | null>(null);
  const [offPanel, setOffPanel] = useState<"" | VehiclePanel>("");

  const preview: DiagramMark[] = placed
    ? [...marks, { id: "pending", panel: placed.panel, positionX: placed.x, positionY: placed.y, severity: "MINOR" }]
    : marks;

  return (
    <form action={formAction} noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <input type="hidden" name="positionX" value={placed ? String(placed.x) : ""} />
      <input type="hidden" name="positionY" value={placed ? String(placed.y) : ""} />
      <input type="hidden" name="panel" value={placed ? placed.panel : offPanel} />

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <VehicleDiagram
          marks={preview}
          onPlace={(position) => {
            setPlaced(position);
            setOffPanel("");
          }}
          selectedId={placed ? "pending" : null}
          label={t("damage.diagramLabel")}
        />
        <div style={{ flex: "1 1 240px", minWidth: 220 }}>
          <div className="field">
            <label htmlFor="addSeverity">{t("damage.severity")}</label>
            <select id="addSeverity" name="severity" defaultValue="MINOR">
              {SEVERITIES.map((level) => (
                <option key={level} value={level}>
                  {t(`severity.${level}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="addOffPanel">{t("damage.elsewhere")}</label>
            <select
              id="addOffPanel"
              value={offPanel}
              onChange={(event) => {
                setOffPanel(event.target.value as VehiclePanel);
                // One or the other: a mark is on the diagram or it is not.
                setPlaced(null);
              }}
            >
              <option value="">{t("damage.onDiagram")}</option>
              {OFF_DIAGRAM_PANELS.map((panel) => (
                <option key={panel} value={panel}>
                  {t(`panels.${panel}`)}
                </option>
              ))}
            </select>
          </div>
          <Field label={t("damage.note")} name="note" />
          <SubmitButton pendingLabel={t("saving")} variant="secondary">
            {t("damage.add")}
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}

/** Both signatures, taken together — never one without the other. */
export function SignHandoverForm({
  action,
  customerName,
  staffName,
}: {
  action: (state: ContractFormState, formData: FormData) => Promise<ContractFormState>;
  customerName: string;
  staffName: string;
}) {
  const [state, formAction] = useActionState<ContractFormState, FormData>(action, {});
  const t = useTranslations("handovers");

  return (
    <form action={formAction} noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <p className="field-hint">{t("sign.hint")}</p>
      <div style={GRID}>
        <div>
          <Field label={t("sign.customerName")} name="customerSignatureName" required defaultValue={customerName} />
          <SignaturePad name="customerSignature" label={t("sign.customerSignature")} clearLabel={t("sign.clear")} />
        </div>
        <div>
          <Field label={t("sign.staffName")} name="staffSignatureName" required defaultValue={staffName} />
          <SignaturePad name="staffSignature" label={t("sign.staffSignature")} clearLabel={t("sign.clear")} />
        </div>
      </div>
      <SubmitButton pendingLabel={t("signing")}>{t("sign.submit")}</SubmitButton>
    </form>
  );
}
