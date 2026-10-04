import { cookies } from "next/headers";

import {
  createSessionToken,
  readSessionToken,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  verifySessionToken,
  type SessionClaims,
} from "@drivenx/auth";

/**
 * Read at call time rather than module load: a missing secret should surface as a
 * clear error on the request that needs it, not as an obscure boot failure.
 */
function sessionSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set. Copy .env.example to .env and generate one.");
  }
  return secret;
}

export async function startSession(userId: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, createSessionToken(userId, sessionSecret()), sessionCookieOptions());
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

export async function sessionUserId(): Promise<string | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value, sessionSecret());
}

/** The signed-in user and when their session began, or null. */
export async function sessionClaims(): Promise<SessionClaims | null> {
  const store = await cookies();
  return readSessionToken(store.get(SESSION_COOKIE_NAME)?.value, sessionSecret());
}
