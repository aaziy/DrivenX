/**
 * Deterministic UAE identifier generators for the golden dataset
 * (IMPLEMENTATION_PLAN.md §2.4).
 *
 * Every value derives from an index. `Math.random` is never called and no value is
 * derived from the clock, so the dataset is byte-identical on every run and a failing
 * test can be reproduced exactly.
 *
 * The *rules* live in `@drivenx/core` — these generators only compose them. That is
 * deliberate: the application validates an Emirates ID with the same function used to
 * mint one here, so fixture data cannot drift into a shape the real form would reject.
 */

import {
  ibanCheckDigits,
  luhnCheckDigit,
  vinCheckCharacter,
} from "@drivenx/core";

// Re-exported so callers of the golden dataset can check their own expectations without
// reaching past it into core.
export {
  formatEmiratesId,
  isValidEmiratesId,
  isValidIban,
  isValidTrn,
  isValidUaeMobile,
  isValidVin,
  luhnCheckDigit,
  normaliseUaeMobile,
  vinCheckCharacter,
} from "@drivenx/core";

// ---------------------------------------------------------------------------
// Emirates ID — 784-YYYY-NNNNNNN-C
// ---------------------------------------------------------------------------

export function emiratesId(index: number, birthYear: number): string {
  const serial = String(1000000 + ((index * 7919) % 8999999)).padStart(7, "0");
  const body = `784${birthYear}${serial}`;
  return `784-${birthYear}-${serial}-${luhnCheckDigit(body)}`;
}

// ---------------------------------------------------------------------------
// TRN — 15 digits. UAE VAT registration numbers begin 100.
// ---------------------------------------------------------------------------

export function trn(index: number): string {
  return `100${String(100000000000 + index * 8171717).slice(0, 12)}`;
}

// ---------------------------------------------------------------------------
// Trade licence
// ---------------------------------------------------------------------------

export function tradeLicenceNumber(index: number): string {
  return `CN-${1000000 + index * 3571}`;
}

// ---------------------------------------------------------------------------
// Plates — Dubai style: single letter code plus up to five digits
// ---------------------------------------------------------------------------

const PLATE_CODES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;

export function plateNumber(index: number): string {
  const code = PLATE_CODES[index % PLATE_CODES.length]!;
  const number = 10000 + ((index * 4463) % 89999);
  return `${code} ${number}`;
}

// ---------------------------------------------------------------------------
// Mobile — +9715X, restricted to operator prefixes actually in use
// ---------------------------------------------------------------------------

const MOBILE_PREFIXES = [50, 52, 54, 55, 56, 58] as const;

export function mobileNumber(index: number): string {
  const prefix = MOBILE_PREFIXES[index % MOBILE_PREFIXES.length]!;
  const subscriber = String(1000000 + ((index * 6131) % 8999999)).padStart(7, "0");
  return `+971${prefix}${subscriber}`;
}

// ---------------------------------------------------------------------------
// VIN — 17 characters, mod-11 check digit at position 9
// ---------------------------------------------------------------------------

/** I, O and Q are excluded from VINs to avoid confusion with 1 and 0. */
const VIN_ALPHABET = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";

/**
 * Deterministic bit-mixing hash (murmur3 finaliser).
 *
 * A linear step such as `index * 31 + i * 17` shifts every character by the same
 * amount, so the whole string repeats with the period of the alphabet length — 33 VINs
 * before the first duplicate. Mixing decorrelates the characters while staying entirely
 * deterministic.
 */
function mix(seed: number): number {
  let h = seed >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export function vin(index: number): string {
  // A plausible WMI plus a deterministic body; the check digit is filled in after.
  let body = "JTD";
  for (let i = 0; i < 14; i += 1) {
    body += VIN_ALPHABET[mix(index * 101 + i * 7919 + 13) % VIN_ALPHABET.length]!;
  }

  const withPlaceholder = `${body.slice(0, 8)}0${body.slice(9, 17)}`;
  const check = vinCheckCharacter(withPlaceholder);
  return `${withPlaceholder.slice(0, 8)}${check}${withPlaceholder.slice(9)}`;
}

// ---------------------------------------------------------------------------
// IBAN — UAE: AE + 2 check digits + 3-digit bank code + 16-digit account
// ---------------------------------------------------------------------------

export function iban(index: number): string {
  const bankCode = String(33 + (index % 60)).padStart(3, "0");
  const account = String(1000000000000000 + index * 7919).slice(0, 16);
  const bban = `${bankCode}${account}`;

  return `AE${ibanCheckDigits(bban)}${bban}`;
}

// ---------------------------------------------------------------------------
// Stable primary keys
// ---------------------------------------------------------------------------

/**
 * Deterministic id in place of a cuid.
 *
 * Fixture expectations reference these directly, and a generated id would change on
 * every run — which is the difference between "this assertion documents the data" and
 * "this assertion documents nothing".
 */
export function goldenId(prefix: string, index: number): string {
  return `gold_${prefix}_${String(index).padStart(3, "0")}`;
}
