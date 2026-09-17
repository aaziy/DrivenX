"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import { login, type LoginState } from "./actions";

export function LoginForm() {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});
  const t = useTranslations("login");

  return (
    <form action={formAction} noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <Field
        label={t("email")}
        name="email"
        type="email"
        required
        autoComplete="username"
        placeholder={t("emailPlaceholder")}
        dir="ltr"
      />
      <Field
        label={t("password")}
        name="password"
        type="password"
        required
        autoComplete="current-password"
        dir="ltr"
      />

      <SubmitButton pendingLabel={t("submitting")}>{t("submit")}</SubmitButton>
    </form>
  );
}
