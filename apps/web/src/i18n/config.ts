/**
 * Interface languages (SOW open question 7, answered 2026-09-16: English and Arabic,
 * each person chooses, Arabic mirrored right-to-left).
 *
 * Free of server-only imports, so client components can use it too.
 */

export const LOCALES = ["en", "ar"] as const;

export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";

/** Remembers the choice on a device, for the sign-in page where nobody is identified yet. */
export const LOCALE_COOKIE = "drivenx_locale";

/** Business records here are kept on Dubai time. */
export const TIME_ZONE = "Asia/Dubai";

export function isLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function directionOf(locale: AppLocale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

/**
 * The tag handed to Intl for dates, numbers and plural rules.
 *
 * Arabic pins two things Intl would otherwise choose for us. Western digits (0–9),
 * because that is how plate numbers, Emirates IDs, invoice numbers and amounts are
 * written in UAE business software — Arabic-Indic digits beside a Latin plate number
 * would read as two different systems. And the Gregorian calendar, which contracts and
 * payment schedules run on. British English gives day/month/year, as dates are written
 * here.
 */
export function intlLocale(locale: AppLocale): string {
  return locale === "ar" ? "ar-AE-u-ca-gregory-nu-latn" : "en-GB";
}

/** Each language is always offered in its own script, never translated. */
export const LANGUAGE_OPTIONS: ReadonlyArray<{ locale: AppLocale; label: string }> = [
  { locale: "en", label: "English" },
  { locale: "ar", label: "العربية" },
];
