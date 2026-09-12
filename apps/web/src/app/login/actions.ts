"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { authenticate } from "@drivenx/auth/session";

import { requestLogger, toUserMessage } from "@/lib/log";
import { startSession } from "@/lib/session";

const LoginSchema = z.object({
  email: z.string().min(1, "Enter your email address.").email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export interface LoginState {
  error?: string;
}

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details you entered." };
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
        return { error: `Too many failed attempts. Try again in ${minutes} minutes.` };
      }
      case "inactive":
        return { error: "This account has been deactivated. Contact your administrator." };
      default:
        // One message for both unknown email and wrong password — anything else turns
        // the login form into a staff directory.
        return { error: "Incorrect email or password." };
    }
  }

  log.info("login succeeded", { userId: result.principal.id });
  await startSession(result.principal.id);
  redirect("/");
}
