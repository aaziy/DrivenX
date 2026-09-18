"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import type { CategoryFormState } from "./actions";

const OWNER_TYPES = ["CUSTOMER", "SUPPLIER", "VEHICLE", "CONTRACT", "INSURANCE_POLICY"] as const;

export interface CategoryDefaults {
  label: string;
  appliesTo: readonly string[];
  requiresExpiry: boolean;
  reminders: string;
}

export function CategoryForm({
  action,
  defaults,
  submitLabelKey = "submit",
}: {
  action: (state: CategoryFormState, formData: FormData) => Promise<CategoryFormState>;
  defaults?: CategoryDefaults;
  submitLabelKey?: "submit" | "save";
}) {
  const [state, formAction] = useActionState<CategoryFormState, FormData>(action, {});
  const t = useTranslations("documentCategories.form");
  const tOwners = useTranslations("documentCategories.owners");

  return (
    <form action={formAction} noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
        }}
      >
        <Field label={t("label")} name="label" required defaultValue={defaults?.label} />
        <Field
          label={t("reminders")}
          name="reminders"
          dir="ltr"
          hint={t("remindersHint")}
          defaultValue={defaults?.reminders}
        />
      </div>

      {/* A group rather than a fieldset: a floated legend once collapsed a list like this
          to zero width and the whole editor rendered blank while every test passed. */}
      <div className="field" role="group" aria-labelledby="appliesTo-label">
        <span className="field-label" id="appliesTo-label">
          {t("appliesTo")}
        </span>
        <div className="row" style={{ flexWrap: "wrap", gap: 14 }}>
          {OWNER_TYPES.map((owner) => (
            <label key={owner} className="checkbox-row">
              <input
                type="checkbox"
                name="appliesTo"
                value={owner}
                defaultChecked={defaults?.appliesTo.includes(owner)}
              />
              <span>{tOwners(owner)}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="checkbox-row">
          <input
            type="checkbox"
            name="requiresExpiry"
            defaultChecked={defaults?.requiresExpiry ?? true}
          />
          <span>{t("requiresExpiry")}</span>
        </label>
      </div>

      <SubmitButton pendingLabel={t(submitLabelKey === "save" ? "saving" : "submitting")}>
        {t(submitLabelKey)}
      </SubmitButton>
    </form>
  );
}
