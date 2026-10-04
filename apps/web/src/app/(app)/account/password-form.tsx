"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import type { AccountFormState, changePasswordAction } from "./actions";

export function PasswordForm({ action }: { action: typeof changePasswordAction }) {
  const [state, formAction] = useActionState<AccountFormState, FormData>(action, {});
  const t = useTranslations("account");

  return (
    // Keyed on the outcome so the fields empty after a successful change: a password left
    // sitting in a form is a password left on the screen.
    <form action={formAction} key={state.success ?? "form"} noValidate style={{ maxWidth: 420 }}>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      <Field
        label={t("currentPassword")}
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
      />
      <Field
        label={t("newPassword")}
        name="newPassword"
        type="password"
        autoComplete="new-password"
        hint={t("policyHint")}
        required
      />
      <Field
        label={t("confirmPassword")}
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
      />
      <SubmitButton pendingLabel={t("saving")}>{t("submit")}</SubmitButton>
    </form>
  );
}
