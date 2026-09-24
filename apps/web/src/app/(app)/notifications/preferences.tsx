"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { SubmitButton } from "@/components/form";

import type { NotificationPreferenceState, setEmailNotificationsAction } from "./actions";

/**
 * Whether this person is emailed about the notifications they can see (P3-01).
 *
 * In-app is deliberately not a setting. It is the record that something was raised at
 * all, and a switch that could hide it would mean a licence expiring with nothing
 * anywhere to show it had ever been noticed.
 */
export function NotificationPreferences({
  action,
  emailNotifications,
}: {
  action: typeof setEmailNotificationsAction;
  emailNotifications: boolean;
}) {
  const [state, formAction] = useActionState<NotificationPreferenceState, FormData>(action, {});
  const t = useTranslations("notifications");

  return (
    <form action={formAction}>
      <input type="hidden" name="emailNotifications" value={emailNotifications ? "off" : "on"} />
      <p className="field-hint">
        {emailNotifications ? t("preferences.emailOn") : t("preferences.emailOff")}
      </p>
      <SubmitButton variant="secondary" pendingLabel={t("preferences.saving")}>
        {emailNotifications ? t("preferences.turnOff") : t("preferences.turnOn")}
      </SubmitButton>
      {state.error ? <span className="field-error">{state.error}</span> : null}
    </form>
  );
}
