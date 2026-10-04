"use server";

import { getTranslations } from "next-intl/server";

import { changeOwnPassword } from "@drivenx/auth/session";

import { asActor, requireUser } from "@/lib/auth";
import { startSession } from "@/lib/session";

export interface AccountFormState {
  error?: string;
  success?: string;
}

/**
 * Change your own password.
 *
 * Every other session ends - that is what the change is for if the old password leaked.
 * This one is renewed in the same breath, so the person making the change is not signed
 * out by it.
 */
export async function changePasswordAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const principal = await requireUser();
  const [t, tp] = await Promise.all([getTranslations("account"), getTranslations("password")]);

  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (next !== confirm) return { error: t("errors.mismatch") };

  const result = await asActor(principal, () => changeOwnPassword(principal.id, current, next));
  if (!result.ok) {
    if (result.reason === "policy") {
      return { error: result.issues.map((issue) => tp(issue.code, issue.params)).join(" ") };
    }
    return {
      error: t(
        result.reason === "wrong_current"
          ? "errors.wrongCurrent"
          : result.reason === "same_as_current"
            ? "errors.sameAsCurrent"
            : "errors.notFound",
      ),
    };
  }

  await startSession(principal.id);
  return { success: t("changed") };
}
