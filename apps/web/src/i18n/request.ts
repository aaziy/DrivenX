import { getRequestConfig } from "next-intl/server";

import { intlLocale, TIME_ZONE } from "./config";
import { currentLocale } from "./locale";

/**
 * Per-request translation setup.
 *
 * The locale handed to next-intl is the full Intl tag rather than "en" or "ar", so
 * dates, numbers and plural rules follow the decisions in config.ts. The `lang` and
 * `dir` attributes on the page come from the plain language code instead.
 */
export default getRequestConfig(async () => {
  const locale = await currentLocale();

  return {
    locale: intlLocale(locale),
    timeZone: TIME_ZONE,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
