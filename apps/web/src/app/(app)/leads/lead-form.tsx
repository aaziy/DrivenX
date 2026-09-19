"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import type { LeadFormState } from "./actions";

const SOURCES = ["WALK_IN", "PHONE", "WHATSAPP", "WEBSITE", "SOCIAL", "REFERRAL", "OTHER"] as const;

const GRID = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 14,
} as const;

export interface LeadDefaults {
  name: string;
  mobile: string;
  email: string;
  source: string;
  interestedVehicleId: string;
  budget: string;
  durationMonths: string;
  notes: string;
  salespersonId: string;
}

export function LeadForm({
  action,
  vehicles,
  salespeople,
  defaults,
  mode,
}: {
  action: (state: LeadFormState, formData: FormData) => Promise<LeadFormState>;
  vehicles: Array<{ id: string; label: string }>;
  /** Null when the reader may not assign leads to others. */
  salespeople: Array<{ id: string; fullName: string }> | null;
  defaults?: LeadDefaults;
  mode: "create" | "edit";
}) {
  const [state, formAction] = useActionState<LeadFormState, FormData>(action, {});
  const t = useTranslations("leads.form");
  const tSources = useTranslations("leads.sources");

  return (
    <form action={formAction} noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <div style={GRID}>
        <Field label={t("name")} name="name" required defaultValue={defaults?.name} />
        <Field label={t("mobile")} name="mobile" required dir="ltr" defaultValue={defaults?.mobile} />
        <Field label={t("email")} name="email" type="email" dir="ltr" defaultValue={defaults?.email} />
        <div className="field">
          <label htmlFor="source">{t("source")}</label>
          <select id="source" name="source" defaultValue={defaults?.source ?? "WALK_IN"}>
            {SOURCES.map((source) => (
              <option key={source} value={source}>
                {tSources(source)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="interestedVehicleId">{t("interest")}</label>
          <select id="interestedVehicleId" name="interestedVehicleId" defaultValue={defaults?.interestedVehicleId ?? ""}>
            <option value="">{t("noVehicle")}</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.label}
              </option>
            ))}
          </select>
        </div>
        <Field label={t("budget")} name="budget" dir="ltr" defaultValue={defaults?.budget} />
        <Field label={t("duration")} name="durationMonths" type="number" dir="ltr" defaultValue={defaults?.durationMonths} />
        {salespeople ? (
          <div className="field">
            <label htmlFor="salespersonId">{t("salesperson")}</label>
            <select id="salespersonId" name="salespersonId" defaultValue={defaults?.salespersonId ?? ""}>
              <option value="">{t("unassigned")}</option>
              {salespeople.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="notes">{t("notes")}</label>
        <textarea id="notes" name="notes" rows={3} defaultValue={defaults?.notes} />
      </div>
      <SubmitButton pendingLabel={mode === "create" ? t("creating") : t("submitting")}>
        {mode === "create" ? t("create") : t("submit")}
      </SubmitButton>
    </form>
  );
}
