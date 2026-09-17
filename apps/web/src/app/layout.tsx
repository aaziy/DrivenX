import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";

import { directionOf } from "@/i18n/config";
import { currentLocale } from "@/i18n/locale";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("appName"), description: t("description") };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await currentLocale();

  // `dir` here is what mirrors the entire interface for Arabic. The stylesheet uses
  // logical properties throughout, so nothing else has to know which way it is facing.
  return (
    <html lang={locale} dir={directionOf(locale)}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
