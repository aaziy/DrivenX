"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import type { VehicleStatus } from "@drivenx/core";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import type { VehicleFormState } from "../actions";

type Action = (state: VehicleFormState, formData: FormData) => Promise<VehicleFormState>;

/**
 * Offers only the moves the state machine allows from the current status. Enforcement is
 * on the server either way; showing only legal options means staff are never invited to
 * pick one that will be refused.
 */
export function StatusForm({ action, options }: { action: Action; options: readonly VehicleStatus[] }) {
  const [state, formAction] = useActionState<VehicleFormState, FormData>(action, {});
  const t = useTranslations("vehicles.detail");
  const tStatus = useTranslations("vehicles.status");

  return (
    <form action={formAction}>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "end" }}>
        <div className="field" style={{ flex: "0 1 220px", marginBottom: 0 }}>
          <label htmlFor="status">{t("changeTo")}</label>
          <select id="status" name="status" defaultValue="">
            <option value="" disabled>
              {t("chooseStatus")}
            </option>
            {options.map((status) => (
              <option key={status} value={status}>
                {tStatus(status)}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: "1 1 240px", marginBottom: 0 }}>
          <label htmlFor="reason">{t("reason")}</label>
          <input id="reason" name="reason" type="text" />
        </div>
        <SubmitButton pendingLabel={t("changing")}>{t("changeStatus")}</SubmitButton>
      </div>
    </form>
  );
}

export function MileageForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState<VehicleFormState, FormData>(action, {});
  const t = useTranslations("vehicles.detail");

  return (
    <form action={formAction}>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "end" }}>
        <div style={{ flex: "0 1 200px" }}>
          <Field label={t("reading")} name="readingKm" type="number" required dir="ltr" />
        </div>
        <div style={{ flex: "1 1 240px" }}>
          <Field label={t("readingNote")} name="note" />
        </div>
        <div className="field">
          <SubmitButton pendingLabel={t("recording")}>{t("record")}</SubmitButton>
        </div>
      </div>
    </form>
  );
}

export function DeleteVehicleForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState<VehicleFormState, FormData>(action, {});
  const t = useTranslations("vehicles.detail");

  return (
    <form action={formAction}>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <SubmitButton variant="secondary" pendingLabel={t("deleting")}>
        {t("delete")}
      </SubmitButton>
    </form>
  );
}
