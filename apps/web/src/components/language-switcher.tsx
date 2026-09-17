"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";

import { setLocale } from "@/i18n/actions";
import { LANGUAGE_OPTIONS, type AppLocale } from "@/i18n/config";

/**
 * The language switch, shown in the sidebar and on the sign-in page.
 *
 * Each language is labelled in its own script, so somebody who cannot read the current
 * interface can still find their way out of it.
 */
export function LanguageSwitcher({ current }: { current: AppLocale }) {
  const t = useTranslations("language");
  const [pending, startTransition] = useTransition();

  return (
    <div className="language-switch" role="group" aria-label={t("label")}>
      {LANGUAGE_OPTIONS.map((option) => {
        const active = option.locale === current;

        return (
          <button
            key={option.locale}
            type="button"
            lang={option.locale}
            className={active ? "language-option language-option-active" : "language-option"}
            aria-pressed={active}
            disabled={pending}
            onClick={() => {
              if (active) return;
              startTransition(async () => {
                await setLocale(option.locale);
              });
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
