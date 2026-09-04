/**
 * P0-06 integration tests — login, bad password, lockout.
 *
 * Every path here writes to the database (failed-login counters, lockout timestamps,
 * audit rows), which is exactly what DoD §3.1 means by "integration tests for new
 * write paths".
 */

import { prisma } from "@drivenx/db";
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_LOCKOUT_POLICY, hashPassword } from "./password";
import { authenticate } from "./session";

const PASSWORD = "DrivenX2026Fleet";
const WRONG = "WrongPassword123";

async function createUser(
  overrides: { email?: string; isActive?: boolean; deletedAt?: Date | null } = {},
) {
  return prisma.user.create({
    data: {
      email: overrides.email ?? "staff@drivenx.ae",
      fullName: "Test Staff",
      passwordHash: await hashPassword(PASSWORD),
      isActive: overrides.isActive ?? true,
      deletedAt: overrides.deletedAt ?? null,
    },
  });
}

describe("authenticate [P0-06]", () => {
  let userId: string;

  beforeEach(async () => {
    const user = await createUser();
    userId = user.id;
  });

  it("succeeds with correct credentials", async () => {
    const result = await authenticate("staff@drivenx.ae", PASSWORD);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.principal.id).toBe(userId);
      expect(result.principal.email).toBe("staff@drivenx.ae");
    }
  });

  it("matches the email case-insensitively", async () => {
    const result = await authenticate("  STAFF@DrivenX.ae  ", PASSWORD);
    expect(result.ok).toBe(true);
  });

  it("rejects a wrong password and increments the failure counter", async () => {
    const result = await authenticate("staff@drivenx.ae", WRONG);

    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.failedLogins).toBe(1);
    expect(user.lockedUntil).toBeNull();
  });

  it("clears the failure counter and stamps lastLoginAt on success", async () => {
    await authenticate("staff@drivenx.ae", WRONG);
    await authenticate("staff@drivenx.ae", WRONG);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).failedLogins).toBe(2);

    await authenticate("staff@drivenx.ae", PASSWORD);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.failedLogins).toBe(0);
    expect(user.lockedUntil).toBeNull();
    expect(user.lastLoginAt).not.toBeNull();
  });

  it("returns invalid_credentials for an unknown email", async () => {
    const result = await authenticate("nobody@drivenx.ae", PASSWORD);
    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("does not distinguish an unknown email from a wrong password", async () => {
    // Different responses here would turn the login form into a staff-directory oracle.
    const unknown = await authenticate("nobody@drivenx.ae", PASSWORD);
    const wrongPassword = await authenticate("staff@drivenx.ae", WRONG);
    expect(unknown).toEqual(wrongPassword);
  });

  it("refuses a soft-deleted user even with the correct password", async () => {
    await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });

    const result = await authenticate("staff@drivenx.ae", PASSWORD);
    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("reports a deactivated user separately from a bad password", async () => {
    // The user needs to be told to contact an administrator, not to try again.
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });

    const result = await authenticate("staff@drivenx.ae", PASSWORD);
    expect(result).toEqual({ ok: false, reason: "inactive" });
  });
});

describe("lockout [P0-06]", () => {
  let userId: string;
  const now = new Date("2026-09-04T09:00:00Z");

  beforeEach(async () => {
    const user = await createUser();
    userId = user.id;
  });

  async function failTimes(count: number, at: Date = now) {
    let last;
    for (let i = 0; i < count; i += 1) {
      last = await authenticate("staff@drivenx.ae", WRONG, DEFAULT_LOCKOUT_POLICY, at);
    }
    return last!;
  }

  it("does not lock before the fifth failure", async () => {
    const result = await failTimes(4);

    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.failedLogins).toBe(4);
    expect(user.lockedUntil).toBeNull();
  });

  it("locks on the fifth failure and persists lockedUntil", async () => {
    const result = await failTimes(5);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("locked_out");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.failedLogins).toBe(5);
    expect(user.lockedUntil?.getTime()).toBe(now.getTime() + 15 * 60_000);
  });

  it("rejects the CORRECT password while locked", async () => {
    // The whole point of a lockout: knowing the password must not bypass it.
    await failTimes(5);

    const result = await authenticate(
      "staff@drivenx.ae",
      PASSWORD,
      DEFAULT_LOCKOUT_POLICY,
      new Date(now.getTime() + 60_000),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("locked_out");
  });

  it("allows login once the window expires", async () => {
    await failTimes(5);

    const afterWindow = new Date(now.getTime() + 16 * 60_000);
    const result = await authenticate("staff@drivenx.ae", PASSWORD, DEFAULT_LOCKOUT_POLICY, afterWindow);

    expect(result.ok).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.failedLogins).toBe(0);
  });

  it("re-locks on a single failure after the window expires", async () => {
    await failTimes(5);
    const afterWindow = new Date(now.getTime() + 16 * 60_000);

    const result = await authenticate("staff@drivenx.ae", WRONG, DEFAULT_LOCKOUT_POLICY, afterWindow);

    expect(result.ok === false && result.reason).toBe("locked_out");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.failedLogins).toBe(6);
  });

  it("does not increment the counter while already locked", async () => {
    await failTimes(5);
    const during = new Date(now.getTime() + 60_000);

    await authenticate("staff@drivenx.ae", WRONG, DEFAULT_LOCKOUT_POLICY, during);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.failedLogins).toBe(5);
  });
});

describe("login audit trail [SOW §17]", () => {
  beforeEach(async () => {
    await createUser();
  });

  it("writes exactly one LOGIN row on success", async () => {
    await authenticate("staff@drivenx.ae", PASSWORD);

    const rows = await prisma.auditLog.findMany({ where: { action: "LOGIN" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityType).toBe("User");
  });

  it("writes one LOGIN_FAILED row per failed attempt", async () => {
    await authenticate("staff@drivenx.ae", WRONG);
    await authenticate("staff@drivenx.ae", WRONG);

    const rows = await prisma.auditLog.findMany({ where: { action: "LOGIN_FAILED" } });
    expect(rows).toHaveLength(2);
  });

  it("does not also log the failure-counter columns as a business change", async () => {
    // Session bookkeeping (failedLogins, lockedUntil, lastLoginAt) must not produce
    // its own UPDATE rows. Two entries per sign-in attempt would triple the volume of
    // the log and bury the changes anyone actually reads it for.
    await authenticate("staff@drivenx.ae", WRONG);
    await authenticate("staff@drivenx.ae", PASSWORD);

    const updates = await prisma.auditLog.findMany({
      where: { entityType: "User", action: "UPDATE" },
    });
    expect(updates).toHaveLength(0);

    const loginRows = await prisma.auditLog.findMany({
      where: { action: { in: ["LOGIN", "LOGIN_FAILED"] } },
    });
    expect(loginRows).toHaveLength(2);
  });

  it("does not write a login audit row for an unknown email", async () => {
    // There is no actor to attribute it to, and a FK to a non-existent user would fail.
    // Scoped to login actions: since P0-09, creating the fixture user in beforeEach
    // legitimately produces its own CREATE row, so a total count proves nothing.
    await authenticate("nobody@drivenx.ae", PASSWORD);

    const loginRows = await prisma.auditLog.count({
      where: { action: { in: ["LOGIN", "LOGIN_FAILED"] } },
    });
    expect(loginRows).toBe(0);
  });
});
