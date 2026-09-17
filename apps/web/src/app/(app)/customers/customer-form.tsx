"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import type { CustomerFormState } from "./actions";

export interface CustomerDefaults {
  fullName: string;
  mobile: string;
  email: string;
  dateOfBirth: string;
  nationality: string;
  addressLine: string;
  city: string;
  emergencyName: string;
  emergencyPhone: string;
  notes: string;
}

export function CustomerForm({
  action,
  defaults,
  submitLabelKey = "submit",
}: {
  action: (state: CustomerFormState, formData: FormData) => Promise<CustomerFormState>;
  defaults?: CustomerDefaults;
  submitLabelKey?: "submit" | "save";
}) {
  const [state, formAction] = useActionState<CustomerFormState, FormData>(action, {});
  const t = useTranslations("customers.form");

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
        <Field
          label={t("fullName")}
          name="fullName"
          required
          autoComplete="off"
          defaultValue={defaults?.fullName}
        />
        {/* A phone number reads left-to-right even on an Arabic page. */}
        <Field
          label={t("mobile")}
          name="mobile"
          type="tel"
          required
          autoComplete="off"
          dir="ltr"
          hint={t("mobileHint")}
          defaultValue={defaults?.mobile}
        />
        <Field
          label={t("email")}
          name="email"
          type="email"
          autoComplete="off"
          dir="ltr"
          defaultValue={defaults?.email}
        />
        <Field
          label={t("dateOfBirth")}
          name="dateOfBirth"
          type="date"
          dir="ltr"
          defaultValue={defaults?.dateOfBirth}
        />
        <Field
          label={t("nationality")}
          name="nationality"
          autoComplete="off"
          defaultValue={defaults?.nationality}
        />
        <Field label={t("city")} name="city" autoComplete="off" defaultValue={defaults?.city} />
        <Field
          label={t("addressLine")}
          name="addressLine"
          autoComplete="off"
          defaultValue={defaults?.addressLine}
        />
        <Field
          label={t("emergencyName")}
          name="emergencyName"
          autoComplete="off"
          defaultValue={defaults?.emergencyName}
        />
        <Field
          label={t("emergencyPhone")}
          name="emergencyPhone"
          type="tel"
          dir="ltr"
          autoComplete="off"
          defaultValue={defaults?.emergencyPhone}
        />
      </div>

      <div className="field">
        <label htmlFor="notes">{t("notes")}</label>
        <textarea id="notes" name="notes" rows={3} defaultValue={defaults?.notes} />
      </div>

      <SubmitButton pendingLabel={t(submitLabelKey === "save" ? "saving" : "submitting")}>
        {t(submitLabelKey)}
      </SubmitButton>
    </form>
  );
}
