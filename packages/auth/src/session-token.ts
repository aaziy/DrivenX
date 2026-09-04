/**
 * Signed session tokens (P0-11).
 *
 * Deliberately small and self-contained. What a session library would add on top of
 * `authenticate()` and `loadPrincipal()` — which we already own — is cookie signing,
 * and that is this file. It also keeps SOW §20 clean: no auth vendor to hand over.
 *
 * Format: `base64url(userId).expiryEpochSeconds.hmacSha256`
 *
 * The token carries a user id and nothing else. No permissions, no roles, no email.
 * Everything else is loaded per request, so a revoked permission or a deactivated
 * account takes effect on the very next request rather than whenever the token
 * happens to expire (see rbac.ts).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** One working day. Long enough not to interrupt a shift, short enough to matter. */
export const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;

export const SESSION_COOKIE_NAME = "drivenx_session";

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(
  userId: string,
  secret: string,
  options: { ttlSeconds?: number; now?: Date } = {},
): string {
  if (!secret) throw new Error("Session secret is not configured.");

  const now = options.now ?? new Date();
  const ttl = options.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  const expiresAt = Math.floor(now.getTime() / 1000) + ttl;

  const payload = `${base64url(userId)}.${expiresAt}`;
  return `${payload}.${signature(payload, secret)}`;
}

/**
 * Verify a token and return the user id, or null.
 *
 * Every failure mode returns null rather than throwing or distinguishing itself:
 * a tampered signature, an expired token and a malformed string are all simply
 * "not signed in".
 */
export function verifySessionToken(
  token: string | undefined | null,
  secret: string,
  now: Date = new Date(),
): string | null {
  if (!token || !secret) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [encodedUserId, expiryText, provided] = parts as [string, string, string];
  const payload = `${encodedUserId}.${expiryText}`;
  const expected = signature(payload, secret);

  // Constant-time comparison. A plain `===` leaks how much of the signature matched
  // through response timing, which is enough to forge one byte at a time.
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length) return null;
  if (!timingSafeEqual(providedBytes, expectedBytes)) return null;

  const expiresAt = Number(expiryText);
  if (!Number.isFinite(expiresAt)) return null;
  if (expiresAt * 1000 <= now.getTime()) return null;

  try {
    const userId = fromBase64url(encodedUserId);
    return userId.length > 0 ? userId : null;
  } catch {
    return null;
  }
}

export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

/**
 * Cookie attributes.
 *
 * `httpOnly` keeps the token away from any injected script. `sameSite=lax` blocks
 * cross-site POSTs while still allowing normal top-level navigation into the app.
 * `secure` is conditional only so local http development works.
 */
export function sessionCookieOptions(
  options: { secure?: boolean; ttlSeconds?: number } = {},
): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: options.secure ?? process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: options.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS,
  };
}
