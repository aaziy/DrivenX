"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import type { SupplierFormState } from "./actions";

export interface SupplierDefaults {
  companyName: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  tradeLicenseNo: string;
  trn: string;
  bankName: string;
  bankAccountName: string;
  iban: string;
  notes: string;
}

export function SupplierForm({
  action,
  defaults,
  submitLabelKey = "submit",
}: {
  action: (state: SupplierFormState, formData: FormData) => Promise<SupplierFormState>;
  defaults?: SupplierDefaults;
  submitLabelKey?: "submit" | "save";
}) {
  const [state, formAction] = useActionState<SupplierFormState, FormData>(action, {});
  const t = useTranslations("suppliers.form");

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
          label={t("companyName")}
          name="companyName"
          required
          autoComplete="off"
          defaultValue={defaults?.companyName}
        />
        <Field
          label={t("contactPerson")}
          name="contactPerson"
          autoComplete="off"
          defaultValue={defaults?.contactPerson}
        />
        {/* Numbers, licence numbers and bank details read left-to-right on an Arabic page. */}
        <Field
          label={t("phone")}
          name="phone"
          type="tel"
          dir="ltr"
          autoComplete="off"
          defaultValue={defaults?.phone}
        />
        <Field
          label={t("email")}
          name="email"
          type="email"
          dir="ltr"
          autoComplete="off"
          defaultValue={defaults?.email}
        />
        <Field
          label={t("tradeLicenseNo")}
          name="tradeLicenseNo"
          dir="ltr"
          autoComplete="off"
          defaultValue={defaults?.tradeLicenseNo}
        />
        <Field
          label={t("trn")}
          name="trn"
          dir="ltr"
          autoComplete="off"
          hint={t("trnHint")}
          defaultValue={defaults?.trn}
        />
        <Field
          label={t("bankName")}
          name="bankName"
          autoComplete="off"
          defaultValue={defaults?.bankName}
        />
        <Field
          label={t("bankAccountName")}
          name="bankAccountName"
          autoComplete="off"
          defaultValue={defaults?.bankAccountName}
        />
        <Field
          label={t("iban")}
          name="iban"
          dir="ltr"
          autoComplete="off"
          hint={t("ibanHint")}
          defaultValue={defaults?.iban}
        />
        <Field
          label={t("address")}
          name="address"
          autoComplete="off"
          defaultValue={defaults?.address}
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
