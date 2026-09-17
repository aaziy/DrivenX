"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import { createUser, type UserFormState } from "./actions";

export function CreateUserForm({ roles }: { roles: { id: string; label: string }[] }) {
  const [state, formAction] = useActionState<UserFormState, FormData>(createUser, {});
  const t = useTranslations("users.form");

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
        <Field label={t("fullName")} name="fullName" required autoComplete="off" />
        <Field label={t("email")} name="email" type="email" required autoComplete="off" dir="ltr" />
        <Field
          label={t("password")}
          name="password"
          type="password"
          required
          autoComplete="new-password"
          hint={t("passwordHint")}
          dir="ltr"
        />
        <div className="field">
          <label htmlFor="roleId">
            {t("role")}
            <span aria-hidden="true"> *</span>
          </label>
          <select id="roleId" name="roleId" required defaultValue="">
            <option value="" disabled>
              {t("chooseRole")}
            </option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <SubmitButton pendingLabel={t("submitting")}>{t("submit")}</SubmitButton>
    </form>
  );
}
