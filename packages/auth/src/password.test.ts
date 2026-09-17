import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCKOUT_POLICY,
  isLockedOut,
  registerFailedLogin,
  registerSuccessfulLogin,
  validatePassword,
} from "./password";

describe("validatePassword", () => {
  it("accepts a compliant password", () => {
    expect(validatePassword("DrivenX2026Fleet")).toEqual({ valid: true, errors: [], issues: [] });
  });

  it("reports every failure at once, not just the first", () => {
    const result = validatePassword("short");
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3); // too short, no uppercase, no digit
  });

  it.each([
    ["Short1", "shorter than 12"],
    ["alllowercase123", "no uppercase"],
    ["ALLUPPERCASE123", "no lowercase"],
    ["NoDigitsInHere", "no digit"],
  ])("rejects %s (%s)", (password) => {
    expect(validatePassword(password).valid).toBe(false);
  });

  it("rejects common passwords that would otherwise satisfy the rules", () => {
    // "Password123" fails length; this one passes every character rule.
    const result = validatePassword("Passw0rd123");
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("too common");
  });

  it("rejects banned passwords case-insensitively", () => {
    expect(validatePassword("DRIVENX123456").valid).toBe(false);
  });

  it("rejects an over-long password", () => {
    // Unbounded input into argon2 is a cheap CPU exhaustion vector.
    expect(validatePassword(`Aa1${"x".repeat(200)}`).valid).toBe(false);
  });

  it("accepts a 12-character password exactly on the boundary", () => {
    expect(validatePassword("Abcdefghij12").valid).toBe(true);
  });
});

describe("validatePassword issue codes", () => {
  it("reports each failure as a code with its parameters, for translated display", () => {
    expect(validatePassword("short").issues).toEqual([
      { code: "tooShort", params: { min: 12 } },
      { code: "missingUppercase" },
      { code: "missingDigit" },
    ]);
  });

  it("keeps the codes and the English messages in step", () => {
    const result = validatePassword("ALLUPPERCASE");
    expect(result.issues.map((issue) => issue.code)).toEqual(["missingLowercase", "missingDigit"]);
    expect(result.errors).toHaveLength(result.issues.length);
  });

  it("carries the limit on an over-long password", () => {
    expect(validatePassword(`Aa1${"x".repeat(200)}`).issues).toContainEqual({
      code: "tooLong",
      params: { max: 128 },
    });
  });

  it("flags a common password", () => {
    expect(validatePassword("Passw0rd123").issues.map((issue) => issue.code)).toContain("tooCommon");
  });
});

describe("lockout policy", () => {
  const now = new Date("2026-09-03T10:00:00Z");

  it("does not lock before the threshold", () => {
    let state = { failedLogins: 0, lockedUntil: null as Date | null };
    for (let i = 0; i < DEFAULT_LOCKOUT_POLICY.maxFailedAttempts - 1; i += 1) {
      state = registerFailedLogin(state, DEFAULT_LOCKOUT_POLICY, now);
    }
    expect(state.failedLogins).toBe(4);
    expect(isLockedOut(state, now)).toBe(false);
  });

  it("locks on the fifth failure", () => {
    let state = { failedLogins: 0, lockedUntil: null as Date | null };
    for (let i = 0; i < DEFAULT_LOCKOUT_POLICY.maxFailedAttempts; i += 1) {
      state = registerFailedLogin(state, DEFAULT_LOCKOUT_POLICY, now);
    }
    expect(state.failedLogins).toBe(5);
    expect(isLockedOut(state, now)).toBe(true);
  });

  it("expires the lock after the window", () => {
    const state = registerFailedLogin(
      { failedLogins: 4, lockedUntil: null },
      DEFAULT_LOCKOUT_POLICY,
      now,
    );
    const duringLock = new Date(now.getTime() + 14 * 60_000);
    const afterLock = new Date(now.getTime() + 16 * 60_000);

    expect(isLockedOut(state, duringLock)).toBe(true);
    expect(isLockedOut(state, afterLock)).toBe(false);
  });

  it("re-locks immediately on the next failure after a lock expires", () => {
    // The counter does not reset on expiry, so waiting out one window buys exactly
    // one more attempt rather than a fresh five.
    const locked = { failedLogins: 5, lockedUntil: new Date(now.getTime() - 60_000) };
    expect(isLockedOut(locked, now)).toBe(false);

    const relocked = registerFailedLogin(locked, DEFAULT_LOCKOUT_POLICY, now);
    expect(relocked.failedLogins).toBe(6);
    expect(isLockedOut(relocked, now)).toBe(true);
  });

  it("clears state on a successful login", () => {
    expect(registerSuccessfulLogin()).toEqual({ failedLogins: 0, lockedUntil: null });
    expect(isLockedOut(registerSuccessfulLogin(), now)).toBe(false);
  });

  it("treats a null lockedUntil as unlocked", () => {
    expect(isLockedOut({ failedLogins: 3, lockedUntil: null }, now)).toBe(false);
  });
});
