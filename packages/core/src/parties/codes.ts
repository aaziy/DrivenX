/**
 * Human-facing party codes — `CUS-00001`, `SUP-00001`.
 *
 * These are what staff read out on the phone and what §16 global search matches, so they
 * are deliberately short, prefixed by kind, and stable for the life of the record. The
 * database id stays a cuid: a code people quote is a label, never a key.
 *
 * Formatting lives here; *allocation* lives in the database, where a sequence can
 * guarantee no two concurrent creates receive the same number.
 */

/**
 * Vehicles share the format though they are not parties: staff read a fleet code out
 * over the phone exactly as they read a customer's, and search resolves both the same way.
 */
export const PARTY_CODE_PREFIX = {
  customer: "CUS",
  supplier: "SUP",
  vehicle: "VEH",
} as const;

export type PartyKind = keyof typeof PARTY_CODE_PREFIX;

/** Codes are padded to five digits — enough for the client's fleet without looking odd. */
const PADDED_WIDTH = 5;

export function formatPartyCode(kind: PartyKind, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`Party code sequence must be a positive integer, received ${sequence}`);
  }

  // Past 99999 the code simply grows. Truncating would mint a duplicate of an existing
  // code, which is far worse than a six-digit number looking slightly wider in a table.
  return `${PARTY_CODE_PREFIX[kind]}-${String(sequence).padStart(PADDED_WIDTH, "0")}`;
}

/**
 * Read a code back, so a search for "CUS-00042" or "cus 42" can look up by number
 * instead of falling through to a text match on every column.
 */
export function parsePartyCode(code: string): { kind: PartyKind; sequence: number } | null {
  const match = /^\s*(CUS|SUP|VEH)[\s-]*(\d{1,12})\s*$/i.exec(code);
  if (!match) return null;

  const prefix = match[1]!.toUpperCase();
  const sequence = Number(match[2]);
  if (sequence < 1) return null;

  const kind = (Object.keys(PARTY_CODE_PREFIX) as PartyKind[]).find(
    (candidate) => PARTY_CODE_PREFIX[candidate] === prefix,
  );

  return kind ? { kind, sequence } : null;
}
