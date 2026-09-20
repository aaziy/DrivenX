"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import type { VehicleFormState } from "./actions";

type Action = (state: VehicleFormState, formData: FormData) => Promise<VehicleFormState>;

const COVERAGE = ["COMPREHENSIVE", "THIRD_PARTY"] as const;

const GRID = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: 12,
} as const;

export function PolicyForm({ action, today }: { action: Action; today: string }) {
  const [state, formAction] = useActionState<VehicleFormState, FormData>(action, {});
  const t = useTranslations("insurance");

  return (
    <form action={formAction} noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      <div style={GRID}>
        <Field label={t("form.provider")} name="provider" required />
        <Field label={t("form.policyNumber")} name="policyNumber" required dir="ltr" />
        <div className="field">
          <label htmlFor="coverage">{t("form.coverage")}</label>
          <select id="coverage" name="coverage" defaultValue="COMPREHENSIVE">
            {COVERAGE.map((value) => (
              <option key={value} value={value}>
                {t(`coverage.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <Field label={t("form.startDate")} name="startDate" type="date" dir="ltr" defaultValue={today} />
        <Field label={t("form.expiryDate")} name="expiryDate" type="date" dir="ltr" />
        <Field label={t("form.premium")} name="premium" required dir="ltr" hint={t("form.premiumHint")} />
      </div>
      <SubmitButton pendingLabel={t("adding")}>{t("add")}</SubmitButton>
    </form>
  );
}

/** Cancelling asks why, and what the insurer gave back; the refund reverses that cost. */
export function CancelPolicyForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState<VehicleFormState, FormData>(action, {});
  const [open, setOpen] = useState(false);
  const t = useTranslations("insurance.cancel");

  if (state.success) {
    return (
      <span className="muted" style={{ fontSize: 12.5 }}>
        {state.success}
      </span>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn-link" onClick={() => setOpen(true)}>
        {t("open")}
      </button>
    );
  }

  return (
    <form action={formAction} className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input name="reason" aria-label={t("reason")} placeholder={t("reason")} style={{ width: 170 }} />
      <input name="refund" aria-label={t("refund")} placeholder={t("refund")} dir="ltr" style={{ width: 150 }} />
      <SubmitButton variant="secondary" pendingLabel={t("cancelling")}>
        {t("confirm")}
      </SubmitButton>
      {state.error ? <span className="field-error">{state.error}</span> : null}
    </form>
  );
}
