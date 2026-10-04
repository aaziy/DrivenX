"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { SubmitButton } from "@/components/form";

import { resetUserPassword, type ResetPasswordState } from "./actions";

/**
 * Setting a password for somebody who has forgotten theirs.
 *
 * Folded away behind a disclosure: it is a rare and consequential action - it signs the
 * person out everywhere - and an open password box on every row of the users list is an
 * invitation to type into the wrong one.
 */
export function ResetPassword({ userId, name }: { userId: string; name: string }) {
  const [state, formAction] = useActionState<ResetPasswordState, FormData>(
    resetUserPassword.bind(null, userId),
    {},
  );
  const t = useTranslations("users.resetPassword");

  return (
    <details>
      <summary className="btn-link" style={{ cursor: "pointer" }}>
        {t("open")}
      </summary>
      <form action={formAction} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          aria-label={t("label", { name })}
          placeholder={t("placeholder")}
          required
        />
        <SubmitButton variant="secondary" pendingLabel={t("saving")}>
          {t("submit")}
        </SubmitButton>
        {state.error ? <span className="field-error">{state.error}</span> : null}
        {state.success ? <span className="muted">{state.success}</span> : null}
      </form>
    </details>
  );
}
