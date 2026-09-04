/**
 * Database-backed authentication (P0-06) and permission resolution (P0-07).
 */

import { randomBytes } from "node:crypto";

import { hash } from "@node-rs/argon2";

import { prisma, withoutAudit } from "@drivenx/db";

import {
  ARGON2_OPTIONS,
  DEFAULT_LOCKOUT_POLICY,
  isLockedOut,
  type LockoutPolicy,
  registerFailedLogin,
  registerSuccessfulLogin,
  verifyPassword,
} from "./password";
import { buildPrincipal, type Principal } from "./rbac";

/**
 * Load a user and resolve their permissions.
 *
 * Called on every authenticated request. Returns null for unknown, soft-deleted or
 * deactivated users, so deactivation takes effect on the very next request rather
 * than when the session happens to expire.
 */
export async function loadPrincipal(userId: string): Promise<Principal | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      email: true,
      fullName: true,
      isActive: true,
      roles: {
        select: {
          role: {
            select: {
              key: true,
              permissions: { select: { permission: { select: { key: true } } } },
            },
          },
        },
      },
    },
  });

  if (!user || !user.isActive) return null;

  return buildPrincipal({
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    isActive: user.isActive,
    roles: user.roles.map((userRole) => ({
      key: userRole.role.key,
      permissions: userRole.role.permissions.map((rp) => rp.permission.key),
    })),
  });
}

export type AuthFailureReason = "invalid_credentials" | "locked_out" | "inactive";

export type AuthResult =
  | { ok: true; principal: Principal }
  | { ok: false; reason: AuthFailureReason; lockedUntil?: Date };

/**
 * Authenticate an email and password.
 *
 * Note on the unknown-email path: we still run an argon2 verification against a dummy
 * hash before returning. Skipping it would make "no such user" measurably faster than
 * "wrong password" and turn login timing into a user-enumeration oracle — which, for a
 * system whose user list is staff names, is a real disclosure.
 */
export async function authenticate(
  email: string,
  password: string,
  policy: LockoutPolicy = DEFAULT_LOCKOUT_POLICY,
  now: Date = new Date(),
): Promise<AuthResult> {
  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase().trim(), deletedAt: null },
    select: {
      id: true,
      passwordHash: true,
      isActive: true,
      failedLogins: true,
      lockedUntil: true,
    },
  });

  if (!user) {
    await verifyPassword(password, await getDummyHash());
    return { ok: false, reason: "invalid_credentials" };
  }

  if (isLockedOut({ failedLogins: user.failedLogins, lockedUntil: user.lockedUntil }, now)) {
    return { ok: false, reason: "locked_out", lockedUntil: user.lockedUntil! };
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);

  if (!passwordMatches) {
    const next = registerFailedLogin(
      { failedLogins: user.failedLogins, lockedUntil: user.lockedUntil },
      policy,
      now,
    );
    // Suppressed: the counter and lockout stamp are session bookkeeping, not business
    // data. The explicit LOGIN_FAILED row below records the event with the right
    // attribution; letting the extension also log the column change would double every
    // sign-in attempt and bury real activity in the log people actually read.
    await withoutAudit(async () => {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: next.failedLogins, lockedUntil: next.lockedUntil },
      });
    });
    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        entityType: "User",
        entityId: user.id,
        action: "LOGIN_FAILED",
        after: { failedLogins: next.failedLogins, lockedUntil: next.lockedUntil?.toISOString() },
      },
    });

    return isLockedOut(next, now)
      ? { ok: false, reason: "locked_out", lockedUntil: next.lockedUntil! }
      : { ok: false, reason: "invalid_credentials" };
  }

  // Correct password but the account is switched off — report separately from a bad
  // password so the user is told to contact an administrator rather than retrying.
  if (!user.isActive) {
    return { ok: false, reason: "inactive" };
  }

  const cleared = registerSuccessfulLogin();
  await withoutAudit(async () => {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: cleared.failedLogins,
        lockedUntil: cleared.lockedUntil,
        lastLoginAt: now,
      },
    });
  });
  await prisma.auditLog.create({
    data: { actorId: user.id, entityType: "User", entityId: user.id, action: "LOGIN" },
  });

  const principal = await loadPrincipal(user.id);
  return principal
    ? { ok: true, principal }
    : { ok: false, reason: "inactive" };
}

/**
 * A genuine argon2id hash over a random throwaway secret, computed once on first use.
 *
 * It must be a real hash: a hand-written placeholder fails argon2's format parse and
 * returns in microseconds, which would leave exactly the timing difference this is
 * meant to erase.
 */
let dummyHash: Promise<string> | undefined;

function getDummyHash(): Promise<string> {
  dummyHash ??= hash(randomBytes(32).toString("hex"), ARGON2_OPTIONS);
  return dummyHash;
}
