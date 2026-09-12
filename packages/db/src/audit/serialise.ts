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

import { isSensitiveField, REDACTED, redactRecord, redactValue } from "@drivenx/core/redaction";

export { isSensitiveField, REDACTED };

/**
 * Fields excluded from diffs because they change on every write and carry no
 * information a reader of the audit log would act on.
 */
const NOISE_FIELDS = new Set(["updatedAt"]);

/** Convert a value into something `JSON.stringify` and a Prisma Json column accept. */
export const toJsonValue = (value: unknown): unknown => redactValue(value);

/** JSON-safe, secret-free snapshot of a whole record. */
export const sanitiseRecord = (record: Record<string, unknown>): Record<string, unknown> =>
  redactRecord(record);

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
