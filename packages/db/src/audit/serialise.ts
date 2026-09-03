/**
 * Turning Prisma records into safe, diffable JSON for the audit log.
 *
 * Two hazards this closes:
 *
 * 1. Secrets. An UPDATE on a user carries `passwordHash`, and without redaction every
 *    argon2 hash in the system ends up mirrored into a table that more people can read
 *    than can read `users`. Audit logs are widely readable by design (SOW §17) — that
 *    is precisely why they must never hold credentials.
 *
 * 2. BigInt. Money is stored as BigInt fils, and `JSON.stringify` throws outright on
 *    BigInt. Left unhandled, the audit extension would start failing the moment
 *    contracts land in milestone 1D — mutation succeeds, audit write explodes.
 */

export const REDACTED = "[redacted]";

/**
 * Field names whose values never reach the audit log.
 * Matching is on the lowercased name so `passwordHash`, `password_hash` and
 * `newPassword` are all caught.
 */
const SENSITIVE_PATTERNS = ["password", "secret", "token", "apikey", "accesskey", "credential"];

export function isSensitiveField(fieldName: string): boolean {
  const normalised = fieldName.toLowerCase().replace(/_/g, "");
  return SENSITIVE_PATTERNS.some((pattern) => normalised.includes(pattern));
}

/**
 * Fields excluded from diffs because they change on every write and carry no
 * information a reader of the audit log would act on.
 */
const NOISE_FIELDS = new Set(["updatedAt"]);

/** Convert a value into something `JSON.stringify` and a Prisma Json column accept. */
export function toJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[binary ${value.byteLength} bytes]`;
  if (Array.isArray(value)) return value.map(toJsonValue);

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isSensitiveField(key) ? REDACTED : toJsonValue(nested);
    }
    return output;
  }

  return value;
}

/** JSON-safe, secret-free snapshot of a whole record. */
export function sanitiseRecord(record: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    output[key] = isSensitiveField(key) ? REDACTED : toJsonValue(value);
  }
  return output;
}

export interface RecordDiff {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/**
 * Field-level diff of two records — only what actually changed.
 *
 * Storing whole rows would make the audit table enormous and, more importantly, make
 * "what did this person change?" a manual comparison exercise for whoever is reading
 * it six months from now.
 *
 * Returns null when nothing meaningful changed, so no-op updates produce no audit row.
 */
export function diffRecords(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): RecordDiff | null {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  let changed = false;

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    if (NOISE_FIELDS.has(key)) continue;

    const previous = toJsonValue(before[key]);
    const next = toJsonValue(after[key]);

    if (JSON.stringify(previous) === JSON.stringify(next)) continue;

    changed = true;
    // A changed secret is recorded as having changed, never as its values.
    if (isSensitiveField(key)) {
      changedBefore[key] = REDACTED;
      changedAfter[key] = REDACTED;
    } else {
      changedBefore[key] = previous;
      changedAfter[key] = next;
    }
  }

  return changed ? { before: changedBefore, after: changedAfter } : null;
}
