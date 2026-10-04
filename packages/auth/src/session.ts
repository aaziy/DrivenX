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
  hashPassword,
  validatePassword,
  verifyPassword,
  type PasswordIssue,
} from "./password";
import { buildPrincipal, type Principal } from "./rbac";

/**
 * Load a user and resolve their permissions.
 *
 * Called on every authenticated request. Returns null for unknown, soft-deleted or
 * deactivated users, so deactivation takes effect on the very next request rather
 * than when the session happens to expire.
 */
export async function loadPrincipal(
  userId: string,
  options: {
    /**
     * When the caller's session began. A session older than the user's last password
     * change is refused, so changing a password ends every session that knew the old
     * one — including one somebody else is holding.
     */
    sessionIssuedAt?: Date;
  } = {},
): Promise<Principal | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      email: true,
      fullName: true,
      isActive: true,
      passwordChangedAt: true,
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

  // Compared in whole seconds, because that is all a session token records. A session
  // begun in the same second as the change - the one the change itself starts - survives.
  if (
    options.sessionIssuedAt &&
    Math.floor(options.sessionIssuedAt.getTime() / 1000) < Math.floor(user.passwordChangedAt.getTime() / 1000)
  ) {
    return null;
  }

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

export type PasswordChangeResult =
  | { ok: true }
  | { ok: false; reason: "wrong_current" | "same_as_current" | "not_found" }
  | { ok: false; reason: "policy"; issues: PasswordIssue[] };

async function storePassword(userId: string, password: string, now: Date): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(password),
      // Ends every session begun before this moment: see `loadPrincipal`.
      passwordChangedAt: now,
      // A new password is a fresh start for the lockout counter too.
      failedLogins: 0,
      lockedUntil: null,
    },
  });
}

/**
 * A person changing their own password.
 *
 * Asks for the current one even though they are signed in: a session left open on a
 * shared computer must not be enough to lock its owner out of their own account.
 */
export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  now: Date = new Date(),
): Promise<PasswordChangeResult> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: true },
    select: { passwordHash: true },
  });
  if (!user) return { ok: false, reason: "not_found" };

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return { ok: false, reason: "wrong_current" };
  }
  if (currentPassword === newPassword) return { ok: false, reason: "same_as_current" };

  const check = validatePassword(newPassword);
  if (!check.valid) return { ok: false, reason: "policy", issues: check.issues };

  await storePassword(userId, newPassword, now);
  return { ok: true };
}

/**
 * An administrator setting somebody's password - the way back from a forgotten one.
 *
 * Signs that person out everywhere, which is the point: if the reset is because the old
 * password leaked, a session opened with it must not outlive the reset.
 */
export async function resetPasswordAsAdmin(
  userId: string,
  newPassword: string,
  now: Date = new Date(),
): Promise<PasswordChangeResult> {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true } });
  if (!user) return { ok: false, reason: "not_found" };

  const check = validatePassword(newPassword);
  if (!check.valid) return { ok: false, reason: "policy", issues: check.issues };

  await storePassword(userId, newPassword, now);
  return { ok: true };
}
