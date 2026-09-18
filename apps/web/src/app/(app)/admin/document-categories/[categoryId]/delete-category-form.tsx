"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { Alert } from "@/components/alert";
import { SubmitButton } from "@/components/form";

import type { CategoryFormState } from "../actions";

/**
 * Removal is refused rather than cascaded when documents are filed under the type, so the
 * outcome has to be shown on the page — a silent no-op would read as a broken button.
 */
export function DeleteCategoryForm({
  action,
}: {
  action: (state: CategoryFormState, formData: FormData) => Promise<CategoryFormState>;
}) {
  const [state, formAction] = useActionState<CategoryFormState, FormData>(action, {});
  const t = useTranslations("documentCategories.form");

  return (
    <form action={formAction}>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <SubmitButton variant="secondary" pendingLabel={t("deleting")}>
        {t("delete")}
      </SubmitButton>
    </form>
  );
}
