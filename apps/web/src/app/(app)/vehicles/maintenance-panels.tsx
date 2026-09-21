"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import type { VehicleFormState } from "./actions";

const TYPES = ["SERVICE", "REPAIR", "TYRES", "INSPECTION", "BODYWORK", "OTHER"] as const;

const GRID = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: 12,
} as const;

export function MaintenanceForm({
  action,
  today,
  odometerKm,
}: {
  action: (state: VehicleFormState, formData: FormData) => Promise<VehicleFormState>;
  today: string;
  odometerKm: number;
}) {
  const [state, formAction] = useActionState<VehicleFormState, FormData>(action, {});
  const t = useTranslations("maintenance");

  return (
    <form action={formAction} noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      <div style={GRID}>
        <div className="field">
          <label htmlFor="maintenanceType">{t("form.type")}</label>
          <select id="maintenanceType" name="type" defaultValue="SERVICE">
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`types.${type}`)}
              </option>
            ))}
          </select>
        </div>
        <Field label={t("form.servicedOn")} name="servicedOn" type="date" dir="ltr" defaultValue={today} />
        {/* Prefilled with what the car last read: the garage's figure is usually higher. */}
        <Field
          label={t("form.odometer")}
          name="odometerKm"
          type="number"
          dir="ltr"
          required
          defaultValue={String(odometerKm)}
        />
        <Field label={t("form.vendor")} name="vendor" required />
        <Field label={t("form.invoiceNumber")} name="vendorInvoiceNumber" dir="ltr" />
        <Field label={t("form.cost")} name="cost" dir="ltr" hint={t("form.costHint")} />
        <Field label={t("form.nextServiceOn")} name="nextServiceOn" type="date" dir="ltr" />
        <Field label={t("form.nextServiceKm")} name="nextServiceKm" type="number" dir="ltr" />
      </div>
      <div className="field">
        <label htmlFor="description">{t("form.description")}</label>
        <input id="description" name="description" />
      </div>
      <SubmitButton pendingLabel={t("adding")}>{t("add")}</SubmitButton>
    </form>
  );
}
