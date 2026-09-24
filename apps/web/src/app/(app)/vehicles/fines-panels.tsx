"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import type { VehicleFormState } from "./actions";

type Action = (state: VehicleFormState, formData: FormData) => Promise<VehicleFormState>;

const GRID = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: 12,
} as const;

export function FineForm({ action, today }: { action: Action; today: string }) {
  const [state, formAction] = useActionState<VehicleFormState, FormData>(action, {});
  const t = useTranslations("fines");

  return (
    <form action={formAction} noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      <div style={GRID}>
        <Field label={t("form.fineNumber")} name="fineNumber" dir="ltr" required />
        <Field label={t("form.authority")} name="authority" required />
        <Field
          label={t("form.occurredOn")}
          name="occurredOn"
          type="date"
          dir="ltr"
          required
          defaultValue={today}
          hint={t("form.occurredOnHint")}
        />
        <Field label={t("form.issuedOn")} name="issuedOn" type="date" dir="ltr" />
        <Field label={t("form.amount")} name="amount" dir="ltr" required hint={t("form.amountHint")} />
        <div className="field">
          <label htmlFor="payer">{t("form.payer")}</label>
          <select id="payer" name="payer" defaultValue="">
            {/* Blank lets the offence date decide, which is right far more often than
                a guess made while typing the notice in. */}
            <option value="">{t("form.payerAuto")}</option>
            <option value="CUSTOMER">{t("payers.CUSTOMER")}</option>
            <option value="COMPANY">{t("payers.COMPANY")}</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="fineNotes">{t("form.notes")}</label>
        <input id="fineNotes" name="notes" />
      </div>
      <SubmitButton pendingLabel={t("adding")}>{t("add")}</SubmitButton>
    </form>
  );
}

/** A status move, with the day the money left when that is what is being recorded. */
export function FineActionForm({
  action,
  label,
  today,
  askPaidOn,
  askReason,
  variant = "secondary",
}: {
  action: Action;
  label: string;
  today: string;
  askPaidOn?: boolean;
  askReason?: boolean;
  variant?: "primary" | "secondary";
}) {
  const [state, formAction] = useActionState<VehicleFormState, FormData>(action, {});
  const t = useTranslations("fines");

  return (
    <form action={formAction} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
      {askPaidOn ? (
        <Field label={t("form.paidOn")} name="paidOn" type="date" dir="ltr" defaultValue={today} />
      ) : null}
      {askReason ? <Field label={t("form.reason")} name="reason" /> : null}
      <SubmitButton variant={variant} pendingLabel={t("working")}>
        {label}
      </SubmitButton>
      {state.error ? <span className="field-error">{state.error}</span> : null}
    </form>
  );
}
