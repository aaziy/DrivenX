"use client";

import { useActionState } from "react";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import { login, type LoginState } from "./actions";

export function LoginForm() {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={formAction} noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <Field
        label="Email"
        name="email"
        type="email"
        required
        autoComplete="username"
        placeholder="you@drivenx.ae"
      />
      <Field
        label="Password"
        name="password"
        type="password"
        required
        autoComplete="current-password"
      />

      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
