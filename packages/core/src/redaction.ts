/**
 * Secret redaction — shared by the audit log and the structured logger.
 *
 * Deliberately in one place. Both the audit trail (SOW §17) and application logs are
 * read by more people than can read the `users` table, and both must never carry
 * credentials. Two copies of this list is how one of them silently stops matching a
 * newly added field name.
 */

export const REDACTED = "[redacted]";

/**
 * Substrings that mark a field as secret. Matching is on the lowercased name with
 * separators stripped, so `passwordHash`, `password_hash`, `PASSWORD-HASH` and
 * `newPassword` are all caught.
 */
const SENSITIVE_PATTERNS = [
  "password",
  "secret",
  "token",
  "apikey",
  "accesskey",
  "credential",
  "authorization",
  "cookie",
  "sessionid",
  "privatekey",
] as const;

export function isSensitiveField(fieldName: string): boolean {
  const normalised = fieldName.toLowerCase().replace(/[_\-\s]/g, "");
  return SENSITIVE_PATTERNS.some((pattern) => normalised.includes(pattern));
}

/**
 * Convert a value into something `JSON.stringify` accepts, redacting secrets as it
 * recurses.
 *
 * BigInt matters here beyond tidiness: money is stored as BigInt fils, and
 * `JSON.stringify` throws outright on BigInt. Without this, logging or auditing any
 * record carrying an amount would fail at exactly the moment it was most needed.
 */
export function redactValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[function]";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return serialiseError(value);
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return `[binary ${value.byteLength} bytes]`;
  }

  if (typeof value === "object") {
    // Cyclic structures are common in ORM results and request objects; without this
    // guard a single log call throws or recurses forever.
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));

    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isSensitiveField(key) ? REDACTED : redactValue(nested, seen);
    }
    return output;
  }

  return value;
}

export interface SerialisedError {
  name: string;
  message: string;
  stack?: string | undefined;
  cause?: unknown;
}

/**
 * Errors do not survive `JSON.stringify` — `{}` is all you get, which is how an
 * incident turns into an empty log line.
 */
export function serialiseError(error: unknown): SerialisedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error.cause !== undefined ? { cause: redactValue(error.cause) } : {}),
    };
  }
  return { name: "NonError", message: String(error) };
}

/** JSON-safe, secret-free snapshot of a record. */
export function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return redactValue(record) as Record<string, unknown>;
}
