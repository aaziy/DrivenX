"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { ACCIDENT_RESPONSIBILITIES } from "@drivenx/core";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import type { VehicleFormState } from "./actions";

type Action = (state: VehicleFormState, formData: FormData) => Promise<VehicleFormState>;

const GRID = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: 12,
} as const;

export function AccidentForm({ action, today }: { action: Action; today: string }) {
  const [state, formAction] = useActionState<VehicleFormState, FormData>(action, {});
  const t = useTranslations("accidents");

  return (
    <form action={formAction} noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      <div style={GRID}>
        <Field label={t("form.occurredOn")} name="occurredOn" type="date" dir="ltr" required defaultValue={today} />
        <Field label={t("form.location")} name="location" required />
        <Field label={t("form.policeReport")} name="policeReportNumber" dir="ltr" />
        <div className="field">
          <label htmlFor="responsibility">{t("form.responsibility")}</label>
          {/* Unknown by default: the police report decides, and that takes weeks. */}
          <select id="responsibility" name="responsibility" defaultValue="UNKNOWN">
            {ACCIDENT_RESPONSIBILITIES.map((value) => (
              <option key={value} value={value}>
                {t(`responsibilities.${value}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="accidentDescription">{t("form.description")}</label>
        <input id="accidentDescription" name="description" />
      </div>
      <SubmitButton pendingLabel={t("adding")}>{t("add")}</SubmitButton>
    </form>
  );
}

/** The garage's bill for putting the car right. */
export function RepairForm({ action, today }: { action: Action; today: string }) {
  const [state, formAction] = useActionState<VehicleFormState, FormData>(action, {});
  const t = useTranslations("accidents");

  return (
    <form action={formAction} noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <div style={GRID}>
        <Field label={t("form.repairVendor")} name="repairVendor" required />
        <Field label={t("form.repairCost")} name="repairCost" dir="ltr" required hint={t("form.repairCostHint")} />
        <Field label={t("form.repairedOn")} name="repairedOn" type="date" dir="ltr" required defaultValue={today} />
      </div>
      <SubmitButton variant="secondary" pendingLabel={t("working")}>
        {t("recordRepair")}
      </SubmitButton>
    </form>
  );
}

export function ClaimForm({
  action,
  today,
  policies,
  noPolicyLabel,
}: {
  action: Action;
  today: string;
  policies: Array<{ id: string; label: string }>;
  noPolicyLabel: string;
}) {
  const [state, formAction] = useActionState<VehicleFormState, FormData>(action, {});
  const t = useTranslations("accidents");

  return (
    <form action={formAction} noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <div style={GRID}>
        <Field label={t("form.claimNumber")} name="claimNumber" dir="ltr" required />
        <Field label={t("form.claimedAmount")} name="claimedAmount" dir="ltr" required />
        <Field label={t("form.lodgedOn")} name="lodgedOn" type="date" dir="ltr" required defaultValue={today} />
        <div className="field">
          <label htmlFor="policyId">{t("form.policy")}</label>
          <select id="policyId" name="policyId" defaultValue={policies[0]?.id ?? ""}>
            <option value="">{noPolicyLabel}</option>
            {policies.map((policy) => (
              <option key={policy.id} value={policy.id}>
                {policy.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <SubmitButton variant="secondary" pendingLabel={t("working")}>
        {t("lodgeClaim")}
      </SubmitButton>
    </form>
  );
}

/**
 * A status move for an accident or a claim, asking only for what that move needs.
 *
 * Settling a claim asks for the money and the day it arrived, because those are the two
 * things the ledger posts and neither can be guessed later from a remittance advice.
 */
export function StatusMoveForm({
  action,
  label,
  today,
  ask,
  variant = "secondary",
}: {
  action: Action;
  label: string;
  today: string;
  ask?: "approved" | "received" | "reason";
  variant?: "primary" | "secondary";
}) {
  const [state, formAction] = useActionState<VehicleFormState, FormData>(action, {});
  const t = useTranslations("accidents");

  return (
    <form action={formAction} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
      {ask === "approved" ? <Field label={t("form.approvedAmount")} name="approvedAmount" dir="ltr" /> : null}
      {ask === "received" ? (
        <>
          <Field label={t("form.receivedAmount")} name="receivedAmount" dir="ltr" required />
          <Field label={t("form.settledOn")} name="settledOn" type="date" dir="ltr" defaultValue={today} />
        </>
      ) : null}
      {ask === "reason" ? <Field label={t("form.reason")} name="reason" /> : null}
      <SubmitButton variant={variant} pendingLabel={t("working")}>
        {label}
      </SubmitButton>
      {state.error ? <span className="field-error">{state.error}</span> : null}
    </form>
  );
}
