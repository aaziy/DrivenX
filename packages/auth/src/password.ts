/**
 * Password policy and hashing (P0-06).
 *
 * Validation returns every failure rather than the first, so the user fixes their
 * password in one attempt instead of discovering the rules one rejection at a time.
 *
 * Hashing lives here rather than in session.ts deliberately: it needs no database, and
 * keeping it db-free lets the seed script hash the initial Super Admin password without
 * creating an auth -> db -> auth package cycle.
 */

import { hash, verify } from "@node-rs/argon2";

/**
 * OWASP-recommended argon2id parameters (19 MiB, 2 iterations, 1 lane).
 * argon2 encodes its parameters into the hash, so raising these later leaves existing
 * hashes verifiable; they can be upgraded on next successful login.
 */
export const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, ARGON2_OPTIONS);
  } catch {
    // A malformed or truncated hash must read as "wrong password", never as an
    // unhandled error that leaks a stack trace to the login screen.
    return false;
  }
}

export interface PasswordPolicy {
  minLength: number;
  maxLength: number;
  requireLowercase: boolean;
  requireUppercase: boolean;
  requireDigit: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 12,
  // argon2 hashes the full input; an unbounded password is a cheap way to burn CPU.
  maxLength: 128,
  requireLowercase: true,
  requireUppercase: true,
  requireDigit: true,
};

/**
 * Passwords rejected regardless of whether they satisfy the character rules.
 * Deliberately short — this is a last line of defence for obvious choices, not a
 * substitute for a breach-corpus check, which belongs in P4-02.
 */
const BANNED_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "passw0rd123",
  "administrator",
  "qwerty123456",
  "letmein12345",
  "welcome12345",
  "drivenx12345",
  "drivenx123456",
  "changeme1234",
  "1234567890ab",
]);

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePassword(
  password: string,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters.`);
  }
  if (password.length > policy.maxLength) {
    errors.push(`Password must be no more than ${policy.maxLength} characters.`);
  }
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    errors.push("Password must contain a lowercase letter.");
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push("Password must contain an uppercase letter.");
  }
  if (policy.requireDigit && !/\d/.test(password)) {
    errors.push("Password must contain a digit.");
  }
  if (BANNED_PASSWORDS.has(password.toLowerCase())) {
    errors.push("That password is too common. Choose something less predictable.");
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Lockout policy
// ---------------------------------------------------------------------------

export interface LockoutPolicy {
  maxFailedAttempts: number;
  lockoutMinutes: number;
}

export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = {
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
};

export interface LockoutState {
  failedLogins: number;
  lockedUntil: Date | null;
}

/** Is the account currently locked, as of `now`? */
export function isLockedOut(state: LockoutState, now: Date = new Date()): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

/**
 * Next lockout state after a failed login.
 *
 * The counter keeps climbing past the threshold rather than resetting, so an attacker
 * who waits out one lockout window is locked again on their next single failure.
 */
export function registerFailedLogin(
  state: LockoutState,
  policy: LockoutPolicy = DEFAULT_LOCKOUT_POLICY,
  now: Date = new Date(),
): LockoutState {
  const failedLogins = state.failedLogins + 1;

  if (failedLogins >= policy.maxFailedAttempts) {
    return {
      failedLogins,
      lockedUntil: new Date(now.getTime() + policy.lockoutMinutes * 60_000),
    };
  }

  return { failedLogins, lockedUntil: state.lockedUntil };
}

/** Cleared state after a successful login. */
export function registerSuccessfulLogin(): LockoutState {
  return { failedLogins: 0, lockedUntil: null };
}
