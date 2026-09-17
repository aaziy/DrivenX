"use client";

import { useTranslations } from "next-intl";

import { SubmitButton } from "@/components/form";

import { setUserActive } from "./actions";

export function ToggleActive({ userId, isActive }: { userId: string; isActive: boolean }) {
  const t = useTranslations("users.actions");
  const tc = useTranslations("common");

  return (
    <form action={setUserActive.bind(null, userId, !isActive)}>
      <SubmitButton variant="secondary" pendingLabel={tc("saving")}>
        {isActive ? t("deactivate") : t("reactivate")}
      </SubmitButton>
    </form>
  );
}
