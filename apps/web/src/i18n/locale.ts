import { cache } from "react";
import { cookies } from "next/headers";

import { prisma } from "@drivenx/db";

import { sessionUserId } from "@/lib/session";

import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type AppLocale } from "./config";

/**
 * The language for this request.
 *
 * Signed in, the account's saved choice wins, so it follows the person to any device.
 * Signed out — the sign-in page — the device cookie decides. On a shared office machine
 * that means nobody's language is changed by whoever used the computer before them.
 *
 * `cache` keeps this to one lookup per request even though the layout, the page and the
 * metadata all ask for it.
 */
export const currentLocale = cache(async (): Promise<AppLocale> => {
  const userId = await sessionUserId();
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { locale: true } });
    if (user) return user.locale;
  }

  const cookieStore = await cookies();
  const stored = cookieStore.get(LOCALE_COOKIE)?.value;
  return isLocale(stored) ? stored : DEFAULT_LOCALE;
});

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** Remember a language on this device, for the pages shown before sign-in. */
export async function rememberLocaleOnDevice(locale: AppLocale): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_YEAR_SECONDS,
  });
}
