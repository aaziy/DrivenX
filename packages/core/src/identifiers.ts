/**
 * UAE identifier rules.
 *
 * These are business rules, not test helpers. The customer form validates an Emirates ID
 * with the same function the golden dataset uses to generate one, so fixture data can
 * never drift away from what the application actually accepts — a drift that shows up as
 * tests passing against data the real form would reject.
 *
 * Checksums are computed, not approximated: a typo in an Emirates ID or an IBAN is worth
 * catching at the point of entry rather than when a payment fails.
 */

// ---------------------------------------------------------------------------
// Emirates ID — 784-YYYY-NNNNNNN-C, with a Luhn digit over the first 14
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

/** Canonical `784-YYYY-NNNNNNN-C` form, or null if the value is not a valid ID. */
export function formatEmiratesId(value: string): string | null {
  if (!isValidEmiratesId(value)) return null;
  const d = value.replace(/\D/g, "");
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 14)}-${d.slice(14)}`;
}

// ---------------------------------------------------------------------------
// Mobile numbers
// ---------------------------------------------------------------------------

/** Mobile prefixes in use in the UAE. A number outside these is a typo, not a network. */
const MOBILE_PREFIXES = ["50", "52", "54", "55", "56", "58"] as const;

/**
 * Reduce any of the forms people actually type to `+9715XXXXXXXX`.
 *
 * Staff will enter `050 123 4567`, `971501234567` or `+971 50 123 4567` for the same
 * customer. Storing them as typed makes the §16 global search miss, and makes the same
 * person look like three.
 */
export function normaliseUaeMobile(value: string): string | null {
  const digits = value.replace(/[^\d+]/g, "").replace(/^\+/, "");

  let national: string;
  if (digits.startsWith("971")) national = digits.slice(3);
  else if (digits.startsWith("0")) national = digits.slice(1);
  else national = digits;

  if (national.length !== 9) return null;
  if (!MOBILE_PREFIXES.some((prefix) => national.startsWith(prefix))) return null;

  return `+971${national}`;
}

export function isValidUaeMobile(value: string): boolean {
  return normaliseUaeMobile(value) !== null;
}

// ---------------------------------------------------------------------------
// TRN — tax registration number
// ---------------------------------------------------------------------------

/**
 * 15 digits. The Federal Tax Authority publishes no check digit, so length and shape are
 * all that can be verified here; a wrong-but-well-formed TRN can only be caught by
 * checking it against the FTA.
 */
export function isValidTrn(value: string): boolean {
  return /^\d{15}$/.test(value.replace(/\s/g, ""));
}

// ---------------------------------------------------------------------------
// VIN — 17 characters, mod-11 check digit at position 9
// ---------------------------------------------------------------------------

const VIN_TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};

const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function vinCheckCharacter(vin: string): string {
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
  const value = vin.toUpperCase();
  if (value.length !== 17) return false;
  // I, O and Q are excluded from VINs to avoid confusion with 1 and 0.
  if (/[IOQ]/.test(value)) return false;
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(value)) return false;
  return value[8] === vinCheckCharacter(value);
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

/**
 * The two check digits for a UAE BBAN.
 *
 * Exported so that anything constructing an IBAN — the golden dataset, most obviously —
 * derives the digits the validator will check rather than inventing its own.
 */
export function ibanCheckDigits(bban: string): string {
  return String(98 - mod97(toNumeric(`${bban}AE00`))).padStart(2, "0");
}

export function isValidIban(iban: string): boolean {
  const compact = iban.replace(/\s/g, "").toUpperCase();
  if (!/^AE\d{21}$/.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  return mod97(toNumeric(rearranged)) === 1;
}
