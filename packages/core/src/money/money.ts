/**
 * Money — AED amounts as integer fils.
 *
 * 1 AED = 100 fils. Every monetary value in DrivenX is a `bigint` count of fils.
 * There are no floats anywhere in the financial path: `0.1 + 0.2 !== 0.3` is not a
 * quirk we are willing to have inside a ledger.
 *
 * Design note — why a plain `bigint` and not a branded type or a class:
 * Prisma returns `bigint` for `BigInt` columns. A branded type would need a cast at
 * every read boundary, and casts that appear everywhere stop being read. The real
 * risk here is float contamination, and `bigint` rules that out structurally — you
 * cannot accidentally mix a `number` into `bigint` arithmetic; TypeScript rejects it.
 *
 * @see IMPLEMENTATION_PLAN.md §2.3 INV-1 — installments must sum exactly to the contract total.
 */

import { divideRound, RoundingMode } from "./rounding";

/** An amount in fils. 1 AED = 100 fils. */
export type Fils = bigint;

export const FILS_PER_AED = 100n;

export const ZERO: Fils = 0n;

/** Beyond this, a JS number cannot represent whole fils exactly. */
const MAX_SAFE_AED = Number.MAX_SAFE_INTEGER / 100;

/** Rate precision: 9 decimal places. */
const RATE_SCALE = 1_000_000_000n;

const AMOUNT_PATTERN = /^([-+])?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Parse an AED string into fils. This is the exact path — use it for user input,
 * imported data and anything originating outside the system.
 *
 * Accepts: "3400", "3,400.50", "AED 3,400.50", "-1200.25", "+99.9"
 * Rejects: more than 2 decimal places, malformed grouping, empty input.
 */
export function parse(input: string): Fils {
  const cleaned = input
    .trim()
    .replace(/^AED\s*/i, "")
    .replace(/\s+/g, "");

  const match = AMOUNT_PATTERN.exec(cleaned);
  if (!match) {
    throw new TypeError(`Money.parse: "${input}" is not a valid AED amount`);
  }

  const [, sign, whole = "0", fraction = ""] = match;
  const wholeFils = BigInt(whole.replace(/,/g, "")) * FILS_PER_AED;
  const fractionFils = BigInt(fraction.padEnd(2, "0"));
  const magnitude = wholeFils + fractionFils;

  return sign === "-" ? -magnitude : magnitude;
}

/**
 * Build fils from a JS number of AED.
 *
 * Convenience only — routes through a string so binary floating point error can never
 * leak in. `1.1 * 100` is 110.00000000000001 and `0.07 * 100` is 7.000000000000001;
 * naive `Math.round(aed * 100)` happens to survive both, but not every value, and we
 * do not want the ledger depending on "happens to".
 *
 * Values with more than 2 decimal places are rounded to the nearest fil via `toFixed`,
 * which carries its own float artefacts (`(1.005).toFixed(2)` is "1.00", not "1.01").
 * Prefer {@link parse} for anything that came from a user, a file or an API.
 */
export function fromAed(aed: number): Fils {
  if (!Number.isFinite(aed)) {
    throw new TypeError(`Money.fromAed: ${aed} is not a finite number`);
  }
  if (Math.abs(aed) > MAX_SAFE_AED) {
    throw new RangeError(
      `Money.fromAed: ${aed} exceeds the precise range for a JS number; use parse() with a string`,
    );
  }
  return parse(aed.toFixed(2));
}

/** Build fils from a raw fils count. */
export function fromFils(fils: bigint | number): Fils {
  if (typeof fils === "number") {
    if (!Number.isInteger(fils)) {
      throw new TypeError(`Money.fromFils: ${fils} is not a whole number of fils`);
    }
    if (!Number.isSafeInteger(fils)) {
      throw new RangeError(`Money.fromFils: ${fils} is outside the safe integer range`);
    }
    return BigInt(fils);
  }
  return fils;
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

export function add(...amounts: readonly Fils[]): Fils {
  return amounts.reduce<Fils>((total, amount) => total + amount, ZERO);
}

export function subtract(minuend: Fils, subtrahend: Fils): Fils {
  return minuend - subtrahend;
}

export function sum(amounts: Iterable<Fils>): Fils {
  let total = ZERO;
  for (const amount of amounts) total += amount;
  return total;
}

export function negate(amount: Fils): Fils {
  return -amount;
}

export function abs(amount: Fils): Fils {
  return amount < ZERO ? -amount : amount;
}

/**
 * Multiply by a whole count — e.g. a monthly rental across 36 months. Exact.
 *
 * Fractional factors are rejected deliberately: they are always a rate, a share or a
 * percentage, and each of those needs an explicit rounding decision. Use
 * {@link applyRate}, {@link percentage} or {@link allocate} instead.
 */
export function multiply(amount: Fils, count: number | bigint): Fils {
  if (typeof count === "number") {
    if (!Number.isInteger(count)) {
      throw new TypeError(
        `Money.multiply: ${count} is not a whole count. Use applyRate() or allocate() for fractional factors.`,
      );
    }
    if (!Number.isSafeInteger(count)) {
      throw new RangeError(`Money.multiply: ${count} is outside the safe integer range`);
    }
    return amount * BigInt(count);
  }
  return amount * count;
}

/**
 * Apply a decimal rate — e.g. `applyRate(amount, 1.05)` for 5% VAT inclusive.
 * Rate precision is 9 decimal places.
 */
export function applyRate(
  amount: Fils,
  rate: number,
  mode: RoundingMode = RoundingMode.HALF_UP,
): Fils {
  if (!Number.isFinite(rate)) {
    throw new TypeError(`Money.applyRate: ${rate} is not a finite rate`);
  }
  const scaledRate = BigInt(Math.round(rate * Number(RATE_SCALE)));
  return divideRound(amount * scaledRate, RATE_SCALE, mode);
}

/** Take a percentage of an amount — `percentage(amount, 5)` is 5%. */
export function percentage(
  amount: Fils,
  percent: number,
  mode: RoundingMode = RoundingMode.HALF_UP,
): Fils {
  if (!Number.isFinite(percent)) {
    throw new TypeError(`Money.percentage: ${percent} is not a finite percentage`);
  }
  // Scale by 1e7 rather than 1e9 so the division by 100 is folded in exactly.
  const scaled = BigInt(Math.round(percent * 10_000_000));
  return divideRound(amount * scaled, RATE_SCALE, mode);
}

// ---------------------------------------------------------------------------
// Allocation — INV-1 lives here
// ---------------------------------------------------------------------------

/**
 * Split an amount into `parts` shares that sum back to exactly the original.
 *
 * Uses largest-remainder distribution: the truncation remainder is handed out one fil
 * at a time to the earliest shares.
 *
 * Worked example — the SOW's AED 2,500 annual insurance (§11) billed monthly:
 * 2500.00 / 12 truncates to 208.33, and 208.33 x 12 is 2,499.96. Four fils vanish.
 * Largest-remainder gives 4 months at 208.34 and 8 at 208.33, summing to exactly
 * 2,500.00. Repeat the naive version across a fleet and the books stop balancing for
 * reasons nobody can trace.
 *
 * This is the single most important function in the system. Every payment schedule
 * goes through it.
 */
export function allocate(total: Fils, parts: number): Fils[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new RangeError(`Money.allocate: parts must be a positive integer, got ${parts}`);
  }

  const divisor = BigInt(parts);
  const base = total / divisor; // bigint division truncates toward zero
  const remainder = total - base * divisor; // |remainder| < parts, sign follows total

  const shares: Fils[] = new Array<Fils>(parts).fill(base);

  const step = remainder < ZERO ? -1n : 1n;
  let outstanding = abs(remainder);
  for (let i = 0; outstanding > ZERO; i += 1, outstanding -= 1n) {
    shares[i] = shares[i]! + step;
  }

  return shares;
}

/**
 * Split an amount across weighted shares that sum back to exactly the original.
 *
 * Truncated shares are topped up by largest fractional remainder, ties broken by
 * position so the result is deterministic.
 */
export function allocateByRatios(total: Fils, ratios: readonly number[]): Fils[] {
  if (ratios.length === 0) {
    throw new RangeError("Money.allocateByRatios: at least one ratio is required");
  }

  const scaled = ratios.map((ratio, index) => {
    if (!Number.isFinite(ratio) || ratio < 0) {
      throw new RangeError(
        `Money.allocateByRatios: ratio at index ${index} must be a non-negative finite number, got ${ratio}`,
      );
    }
    return BigInt(Math.round(ratio * Number(RATE_SCALE)));
  });

  const totalWeight = sum(scaled);
  if (totalWeight === ZERO) {
    throw new RangeError("Money.allocateByRatios: ratios sum to zero");
  }

  const shares: Fils[] = [];
  const remainders: Array<{ index: number; remainder: bigint }> = [];
  let allocated = ZERO;

  for (const [index, weight] of scaled.entries()) {
    const numerator = total * weight;
    const share = numerator / totalWeight; // truncates toward zero
    shares.push(share);
    allocated += share;
    remainders.push({ index, remainder: abs(numerator % totalWeight) });
  }

  // Largest remainder first; ties resolved by original position for determinism.
  remainders.sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );

  const shortfall = total - allocated;
  const step = shortfall < ZERO ? -1n : 1n;
  let outstanding = abs(shortfall);
  for (let k = 0; outstanding > ZERO; k += 1, outstanding -= 1n) {
    const target = remainders[k]!.index;
    shares[target] = shares[target]! + step;
  }

  return shares;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export const isZero = (amount: Fils): boolean => amount === ZERO;
export const isPositive = (amount: Fils): boolean => amount > ZERO;
export const isNegative = (amount: Fils): boolean => amount < ZERO;
export const equals = (a: Fils, b: Fils): boolean => a === b;
export const min = (a: Fils, b: Fils): Fils => (a < b ? a : b);
export const max = (a: Fils, b: Fils): Fils => (a > b ? a : b);

/** -1 if a < b, 0 if equal, 1 if a > b. Suitable for Array.prototype.sort. */
export function compare(a: Fils, b: Fils): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Exact decimal string, always 2 places, no grouping: "3400.50". For exports. */
export function toDecimalString(amount: Fils): string {
  const magnitude = abs(amount);
  const whole = magnitude / FILS_PER_AED;
  const fraction = magnitude % FILS_PER_AED;
  return `${amount < ZERO ? "-" : ""}${whole}.${fraction.toString().padStart(2, "0")}`;
}

export interface FormatOptions {
  /** Currency prefix. Pass `null` to omit. Default "AED". */
  currency?: string | null;
  /** Group thousands with commas. Default true. */
  grouping?: boolean;
}

/** Human-readable: "AED 3,400.50". For UI and PDFs. */
export function format(amount: Fils, options: FormatOptions = {}): string {
  const { currency = "AED", grouping = true } = options;

  const decimal = toDecimalString(amount);
  const negative = decimal.startsWith("-");
  const unsigned = negative ? decimal.slice(1) : decimal;
  const [whole = "0", fraction = "00"] = unsigned.split(".");

  const groupedWhole = grouping ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : whole;
  const body = `${negative ? "-" : ""}${groupedWhole}.${fraction}`;

  return currency ? `${currency} ${body}` : body;
}

/**
 * Lossy conversion to a JS number of AED.
 *
 * For charts, spreadsheet cells and anything that cannot consume a bigint.
 * Never feed the result back into a calculation.
 */
export function toAedNumber(amount: Fils): number {
  return Number(amount) / 100;
}

export { RoundingMode } from "./rounding";
