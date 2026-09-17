"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { authenticate } from "@drivenx/auth/session";
import { prisma } from "@drivenx/db";

import { rememberLocaleOnDevice } from "@/i18n/locale";
import { requestLogger, toUserMessage } from "@/lib/log";
import { startSession } from "@/lib/session";

export interface LoginState {
  error?: string;
}

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const [t, tc] = await Promise.all([
    getTranslations("login.errors"),
    getTranslations("common"),
  ]);

  // Built per request so validation messages come out in the language on screen.
  const LoginSchema = z.object({
    email: z.string().min(1, t("emailRequired")).email(t("emailInvalid")),
    password: z.string().min(1, t("passwordRequired")),
  });

  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? tc("checkDetails") };
  }

  const log = await requestLogger();

  let result: Awaited<ReturnType<typeof authenticate>>;
  try {
    result = await authenticate(parsed.data.email, parsed.data.password);
  } catch (error) {
    return { error: await toUserMessage("login", error) };
  }

  if (!result.ok) {
    // The email is recorded; the password is never passed to the logger, and would be
    // redacted by field name if it ever were.
    log.warn("login rejected", { email: parsed.data.email, reason: result.reason });

    switch (result.reason) {
      case "locked_out": {
        // Telling the user the account is locked is a deliberate disclosure: they
        // already proved they know the email, and without it they will keep retrying
        // and extend their own lockout.
        const minutes = result.lockedUntil
          ? Math.max(1, Math.ceil((result.lockedUntil.getTime() - Date.now()) / 60_000))
          : 15;
        return { error: t("lockedOut", { minutes }) };
      }
      case "inactive":
        return { error: t("inactive") };
      default:
        // One message for both unknown email and wrong password — anything else turns
        // the login form into a staff directory.
        return { error: t("invalid") };
    }
  }

  log.info("login succeeded", { userId: result.principal.id });
  await startSession(result.principal.id);

  // Hand the device over to this person's saved language, so the sign-in page they see
  // after signing out matches the app they were just using.
  const account = await prisma.user.findUnique({
    where: { id: result.principal.id },
    select: { locale: true },
  });
  if (account) await rememberLocaleOnDevice(account.locale);

  redirect("/");
}
