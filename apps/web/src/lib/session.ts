import { cookies } from "next/headers";

import {
  createSessionToken,
  readSessionToken,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  usableSessionSecret,
  verifySessionToken,
  type SessionClaims,
} from "@drivenx/auth";

/**
 * Read at call time rather than module load: a missing secret should surface as a
 * clear error on the request that needs it, not as an obscure boot failure.
 */
function sessionSecret(): string {
  // Refuses the public placeholder and anything too short in production: the repository
  // is public, so a known secret would let anybody forge a session for any account.
  return usableSessionSecret(process.env.AUTH_SECRET, process.env.NODE_ENV === "production");
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
