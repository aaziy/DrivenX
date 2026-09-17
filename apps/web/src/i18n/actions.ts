"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@drivenx/db";

import { asActor, currentPrincipal } from "@/lib/auth";

import { isLocale } from "./config";
import { rememberLocaleOnDevice } from "./locale";

/**
 * Switch the interface language.
 *
 * Reachable by anyone, signed in or not, because the switch also sits on the sign-in
 * page. The value is therefore checked against the supported list and anything else is
 * ignored rather than written to the account.
 *
 * A signed-in choice is saved to the account and to the device, so the sign-in page
 * after signing out is in the same language as the app they were just using.
 */
export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;

  await rememberLocaleOnDevice(locale);

  const principal = await currentPrincipal();
  if (principal) {
    await asActor(principal, async () => {
      await prisma.user.update({ where: { id: principal.id }, data: { locale } });
    });
  }

  // The language lives on the root layout, so the whole tree re-renders.
  revalidatePath("/", "layout");
}
