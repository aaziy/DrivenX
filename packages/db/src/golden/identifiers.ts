/**
 * Deterministic UAE identifier generators for the golden dataset
 * (IMPLEMENTATION_PLAN.md §2.4).
 *
 * Every value derives from an index. `Math.random` is never called and no value is
 * derived from the clock, so the dataset is byte-identical on every run and a failing
 * test can be reproduced exactly.
 *
 * Checksums are computed properly rather than faked. Emirates ID carries a Luhn digit,
 * VIN a mod-11 digit, IBAN a mod-97 pair — and milestone 1A adds validation for these.
 * Seeding data that fails our own validators would make the golden dataset useless the
 * day that validation lands.
 */

// ---------------------------------------------------------------------------
// Emirates ID — 784-YYYY-NNNNNNN-C, Luhn check digit over the first 14 digits
// ---------------------------------------------------------------------------

export function luhnCheckDigit(digits: string): number {
  let sum = 0;
  let double = true; // The check digit sits to the right, so doubling starts here.

  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }

  return (10 - (sum % 10)) % 10;
}

export function isValidEmiratesId(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 15 || !digits.startsWith("784")) return false;
  return luhnCheckDigit(digits.slice(0, 14)) === Number(digits[14]);
}

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

const VIN_TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};

const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

function vinCheckCharacter(vin: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    const character = vin[i]!;
    const value = /\d/.test(character) ? Number(character) : (VIN_TRANSLITERATION[character] ?? 0);
    sum += value * VIN_WEIGHTS[i]!;
  }
  const remainder = sum % 11;
  return remainder === 10 ? "X" : String(remainder);
}

export function isValidVin(vin: string): boolean {
  if (vin.length !== 17) return false;
  if (/[IOQ]/.test(vin)) return false;
  return vin[8] === vinCheckCharacter(vin);
}

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

function mod97(input: string): number {
  // Processed in chunks: the full number exceeds Number.MAX_SAFE_INTEGER.
  let remainder = 0;
  for (const character of input) {
    remainder = (remainder * 10 + Number(character)) % 97;
  }
  return remainder;
}

function toNumeric(input: string): string {
  return [...input]
    .map((character) =>
      /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character,
    )
    .join("");
}

export function isValidIban(iban: string): boolean {
  const compact = iban.replace(/\s/g, "").toUpperCase();
  if (!/^AE\d{21}$/.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  return mod97(toNumeric(rearranged)) === 1;
}

export function iban(index: number): string {
  const bankCode = String(33 + (index % 60)).padStart(3, "0");
  const account = String(1000000000000000 + index * 7919).slice(0, 16);
  const bban = `${bankCode}${account}`;

  const rearranged = toNumeric(`${bban}AE00`);
  const checkDigits = String(98 - mod97(rearranged)).padStart(2, "0");

  return `AE${checkDigits}${bban}`;
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
