"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import type { DocumentFormState } from "./actions";

export interface CategoryOption {
  id: string;
  label: string;
  requiresExpiry: boolean;
}

export function DocumentUploadForm({
  action,
  categories,
  limitMb,
}: {
  action: (state: DocumentFormState, formData: FormData) => Promise<DocumentFormState>;
  categories: CategoryOption[];
  limitMb: number;
}) {
  const [state, formAction] = useActionState<DocumentFormState, FormData>(action, {});
  const t = useTranslations("documents.form");
  const [categoryId, setCategoryId] = useState("");

  // Marking the expiry field required follows the chosen type, so the rule is visible
  // before submitting rather than explained afterwards by a rejection.
  const requiresExpiry = categories.find((category) => category.id === categoryId)?.requiresExpiry;

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
        <div className="field">
          <label htmlFor="categoryId">
            {t("category")}
            <span aria-hidden="true"> *</span>
          </label>
          <select
            id="categoryId"
            name="categoryId"
            required
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="" disabled>
              {t("chooseCategory")}
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="file">
            {t("file")}
            <span aria-hidden="true"> *</span>
          </label>
          <input
            id="file"
            name="file"
            type="file"
            required
            accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
            aria-describedby="file-hint"
          />
          <span className="field-hint" id="file-hint">
            {t("fileHint", { limitMb })}
          </span>
        </div>

        <Field label={t("documentNumber")} name="documentNumber" dir="ltr" autoComplete="off" />
        <Field label={t("issueDate")} name="issueDate" type="date" dir="ltr" />
        <Field
          label={t("expiryDate")}
          name="expiryDate"
          type="date"
          dir="ltr"
          required={requiresExpiry}
        />
      </div>

      <SubmitButton pendingLabel={t("submitting")}>{t("submit")}</SubmitButton>
    </form>
  );
}
