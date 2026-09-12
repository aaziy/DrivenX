/**
 * User-facing error reporting (P0-13).
 *
 * The rule: a user sees a short reference, the log holds the detail.
 *
 * Rendering an exception message in the UI leaks schema names, file paths and
 * constraint text to whoever is looking at the screen. Showing nothing at all leaves
 * support with "it broke" and no way to find the request. A reference code gives the
 * user something to quote and gives support an exact key to grep for.
 */

/**
 * An error whose message is safe to display.
 *
 * Everything else is reported as a generic failure. Validation messages, "that email
 * is already in use", "you cannot deactivate your own account" — those are written for
 * users and should reach them; a Prisma constraint violation is not.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export function isUserFacingError(error: unknown): error is UserFacingError {
  return error instanceof UserFacingError;
}

/**
 * Short, unambiguous reference shown to the user and logged alongside the cause.
 *
 * Crockford-style alphabet: no I, L, O or U, so a code read aloud over the phone or
 * copied from a screenshot does not turn into a different code.
 */
const REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newErrorReference(): string {
  // Web Crypto rather than node:crypto: this module is reachable from Next's
  // instrumentation hook, which is compiled for the Edge runtime where node: imports
  // fail the build outright.
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);

  let reference = "";
  // 256 is an exact multiple of 32, so the modulo introduces no bias.
  for (const byte of bytes) reference += REFERENCE_ALPHABET[byte % 32];

  return `${reference.slice(0, 4)}-${reference.slice(4)}`;
}

export const GENERIC_ERROR_MESSAGE =
  "Something went wrong. Nothing was saved. Quote this reference if you contact support:";
