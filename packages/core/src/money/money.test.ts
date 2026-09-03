import { describe, expect, it } from "vitest";

import * as Money from "./money";
import { RoundingMode } from "./rounding";

/**
 * Widest gap between any two shares.
 *
 * Note: `Money.max`/`Money.min` take exactly two arguments, so spreading an array into
 * them silently compares only the first two elements. This walks the whole array.
 */
function spreadOf(values: readonly bigint[]): bigint {
  let low = values[0]!;
  let high = values[0]!;
  for (const value of values) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  return high - low;
}

/** Deterministic PRNG — property tests must be reproducible when they fail. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("parse", () => {
  it.each([
    ["3400", 340000n],
    ["3,400.50", 340050n],
    ["AED 3,400.50", 340050n],
    ["aed 3400", 340000n],
    ["-1200.25", -120025n],
    ["+99.9", 9990n],
    ["0.05", 5n],
    ["0", 0n],
    ["0.00", 0n],
    ["1,234,567.89", 123456789n],
    ["  3400.5  ", 340050n],
  ])("parses %s to %s fils", (input, expected) => {
    expect(Money.parse(input)).toBe(expected);
  });

  it.each([
    ["", "empty"],
    ["abc", "non-numeric"],
    ["3400.555", "three decimal places"],
    ["3,40", "malformed grouping"],
    ["1,2345", "malformed grouping"],
    ["3400.", "trailing separator"],
    ["--5", "double sign"],
    ["3.4.5", "two separators"],
  ])("rejects %s (%s)", (input) => {
    expect(() => Money.parse(input)).toThrow(TypeError);
  });

  it("rejects a third decimal place rather than silently rounding it", () => {
    // Silent rounding of input is how fils go missing without a trace.
    expect(() => Money.parse("100.999")).toThrow();
  });
});

describe("fromAed", () => {
  it("does not leak binary floating point error", () => {
    // 1.1 * 100 === 110.00000000000001 and 0.07 * 100 === 7.000000000000001
    expect(Money.fromAed(1.1)).toBe(110n);
    expect(Money.fromAed(0.07)).toBe(7n);
  });

  it.each([
    [3400.5, 340050n],
    [2400, 240000n],
    [0, 0n],
    [-1200.25, -120025n],
    [99.99, 9999n],
  ])("converts %s AED to %s fils", (input, expected) => {
    expect(Money.fromAed(input)).toBe(expected);
  });

  it.each([NaN, Infinity, -Infinity])("rejects %s", (input) => {
    expect(() => Money.fromAed(input)).toThrow(TypeError);
  });

  it("rejects values beyond exact float representation", () => {
    expect(() => Money.fromAed(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });
});

describe("fromFils", () => {
  it("passes bigints through", () => {
    expect(Money.fromFils(340050n)).toBe(340050n);
  });

  it("accepts whole numbers", () => {
    expect(Money.fromFils(100)).toBe(100n);
  });

  it("rejects fractional fils — there is no such thing", () => {
    expect(() => Money.fromFils(1.5)).toThrow(TypeError);
  });
});

describe("arithmetic", () => {
  it("adds", () => {
    expect(Money.add(340000n, 250000n, 5n)).toBe(590005n);
    expect(Money.add()).toBe(0n);
  });

  it("subtracts", () => {
    expect(Money.subtract(340000n, 230000n)).toBe(110000n);
  });

  it("sums an iterable", () => {
    expect(Money.sum([1n, 2n, 3n])).toBe(6n);
    expect(Money.sum([])).toBe(0n);
  });

  it("negates and takes magnitude", () => {
    expect(Money.negate(500n)).toBe(-500n);
    expect(Money.abs(-500n)).toBe(500n);
    expect(Money.abs(500n)).toBe(500n);
  });

  describe("multiply", () => {
    it("multiplies by a whole count exactly", () => {
      // SOW §8: AED 1,100/month gross profit over 36 months
      expect(Money.multiply(110000n, 36)).toBe(3960000n);
    });

    it("accepts bigint counts", () => {
      expect(Money.multiply(100n, 3n)).toBe(300n);
    });

    it("handles zero and negatives", () => {
      expect(Money.multiply(340000n, 0)).toBe(0n);
      expect(Money.multiply(340000n, -2)).toBe(-680000n);
    });

    it("rejects fractional factors — those need an explicit rounding decision", () => {
      expect(() => Money.multiply(100n, 1.5)).toThrow(TypeError);
    });
  });
});

describe("rates and percentages", () => {
  it("applies a rate", () => {
    // AED 100.00 with 5% VAT added
    expect(Money.applyRate(10000n, 1.05)).toBe(10500n);
  });

  it("rounds half away from zero by default", () => {
    expect(Money.applyRate(333n, 0.5)).toBe(167n); // 166.5 -> 167
    expect(Money.applyRate(-333n, 0.5)).toBe(-167n); // symmetric
  });

  it("honours an explicit rounding mode", () => {
    expect(Money.applyRate(333n, 0.5, RoundingMode.DOWN)).toBe(166n);
    expect(Money.applyRate(333n, 0.5, RoundingMode.HALF_EVEN)).toBe(166n); // tie -> even
  });

  it("takes a percentage", () => {
    // 5% VAT on the SOW's AED 3,400 monthly rental — pre-wired for Open Question 1
    expect(Money.percentage(340000n, 5)).toBe(17000n);
    expect(Money.percentage(340000n, 0)).toBe(0n);
    expect(Money.percentage(340000n, 100)).toBe(340000n);
  });

  it("rejects non-finite rates", () => {
    expect(() => Money.applyRate(100n, NaN)).toThrow(TypeError);
    expect(() => Money.percentage(100n, Infinity)).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// INV-1 — the invariant that quietly destroys ledgers
// ---------------------------------------------------------------------------

describe("allocate [INV-1]", () => {
  it("splits the SOW's AED 2,500 annual insurance across 12 months without losing fils", () => {
    const shares = Money.allocate(250000n, 12);

    // Naive division gives 208.33 x 12 = 2,499.96 and four fils disappear.
    expect(Money.sum(shares)).toBe(250000n);
    expect(shares.filter((s) => s === 20834n)).toHaveLength(4);
    expect(shares.filter((s) => s === 20833n)).toHaveLength(8);
  });

  it("splits a 36-month contract total exactly", () => {
    // SOW Key Financial Logic: AED 3,400/month over 36 months
    const total = Money.multiply(340000n, 36);
    const shares = Money.allocate(total, 36);

    expect(Money.sum(shares)).toBe(total);
    expect(new Set(shares).size).toBe(1); // divides evenly, no remainder
  });

  it.each([
    [10n, 3, [4n, 3n, 3n]],
    [1n, 3, [1n, 0n, 0n]],
    [0n, 5, [0n, 0n, 0n, 0n, 0n]],
    [100n, 1, [100n]],
    [-10n, 3, [-4n, -3n, -3n]],
  ])("allocates %s over %i parts", (total, parts, expected) => {
    expect(Money.allocate(total, parts)).toEqual(expected);
  });

  it("keeps negative allocations symmetric with positive ones", () => {
    const positive = Money.allocate(250000n, 12);
    const negative = Money.allocate(-250000n, 12);
    expect(negative).toEqual(positive.map((s) => -s));
    expect(Money.sum(negative)).toBe(-250000n);
  });

  it("never spreads shares by more than one fil", () => {
    expect(spreadOf(Money.allocate(100n, 7))).toBe(1n);
    expect(spreadOf(Money.allocate(700n, 7))).toBe(0n);
    expect(spreadOf(Money.allocate(250000n, 12))).toBe(1n);
  });

  it.each([0, -1, 1.5, NaN])("rejects %s parts", (parts) => {
    expect(() => Money.allocate(100n, parts)).toThrow(RangeError);
  });

  it("sums back to the total for 2,000 seeded random splits", () => {
    const random = mulberry32(20260903);
    const failures: string[] = [];

    for (let i = 0; i < 2000; i += 1) {
      const sign = random() < 0.15 ? -1n : 1n;
      const total = sign * BigInt(Math.floor(random() * 10_000_000));
      const parts = 1 + Math.floor(random() * 120);

      const shares = Money.allocate(total, parts);
      const actual = Money.sum(shares);

      if (actual !== total) {
        failures.push(`allocate(${total}, ${parts}) summed to ${actual}`);
      }
      if (shares.length !== parts) {
        failures.push(`allocate(${total}, ${parts}) produced ${shares.length} shares`);
      }
      const spread = spreadOf(shares);
      if (spread > 1n) {
        failures.push(`allocate(${total}, ${parts}) spread shares by ${spread} fils`);
      }
    }

    expect(failures).toEqual([]);
  });
});

describe("allocateByRatios [INV-1]", () => {
  it("splits evenly when ratios are equal", () => {
    const shares = Money.allocateByRatios(100n, [1, 1, 1]);
    expect(Money.sum(shares)).toBe(100n);
    expect(shares).toEqual([34n, 33n, 33n]);
  });

  it("splits by weight and still sums exactly", () => {
    const shares = Money.allocateByRatios(340050n, [0.5, 0.3, 0.2]);
    expect(Money.sum(shares)).toBe(340050n);
    expect(shares).toEqual([170025n, 102015n, 68010n]);
  });

  it("gives zero-weight shares nothing", () => {
    expect(Money.allocateByRatios(100n, [1, 0])).toEqual([100n, 0n]);
  });

  it("is deterministic across runs", () => {
    const a = Money.allocateByRatios(1000n, [1, 1, 1, 1, 1, 1, 7]);
    const b = Money.allocateByRatios(1000n, [1, 1, 1, 1, 1, 1, 7]);
    expect(a).toEqual(b);
  });

  it("handles negative totals", () => {
    const shares = Money.allocateByRatios(-100n, [1, 1, 1]);
    expect(Money.sum(shares)).toBe(-100n);
  });

  it("rejects empty, all-zero and negative ratios", () => {
    expect(() => Money.allocateByRatios(100n, [])).toThrow(RangeError);
    expect(() => Money.allocateByRatios(100n, [0, 0])).toThrow(RangeError);
    expect(() => Money.allocateByRatios(100n, [1, -1])).toThrow(RangeError);
  });

  it("sums back to the total for 1,000 seeded random weightings", () => {
    const random = mulberry32(777);
    const failures: string[] = [];

    for (let i = 0; i < 1000; i += 1) {
      const total = BigInt(Math.floor(random() * 5_000_000));
      const count = 1 + Math.floor(random() * 20);
      const ratios = Array.from({ length: count }, () => random() * 10);

      const shares = Money.allocateByRatios(total, ratios);
      const actual = Money.sum(shares);
      if (actual !== total) {
        failures.push(`allocateByRatios(${total}, [${ratios.join(",")}]) summed to ${actual}`);
      }
    }

    expect(failures).toEqual([]);
  });
});

describe("comparison", () => {
  it("classifies", () => {
    expect(Money.isZero(0n)).toBe(true);
    expect(Money.isPositive(1n)).toBe(true);
    expect(Money.isNegative(-1n)).toBe(true);
    expect(Money.isPositive(0n)).toBe(false);
  });

  it("compares and bounds", () => {
    expect(Money.compare(1n, 2n)).toBe(-1);
    expect(Money.compare(2n, 1n)).toBe(1);
    expect(Money.compare(1n, 1n)).toBe(0);
    expect(Money.min(1n, 2n)).toBe(1n);
    expect(Money.max(1n, 2n)).toBe(2n);
    expect(Money.equals(5n, 5n)).toBe(true);
  });

  it("sorts correctly via compare", () => {
    expect([300n, -100n, 0n, 50n].sort(Money.compare)).toEqual([-100n, 0n, 50n, 300n]);
  });
});

describe("formatting", () => {
  it.each([
    [340050n, "3400.50"],
    [-120025n, "-1200.25"],
    [5n, "0.05"],
    [0n, "0.00"],
    [100n, "1.00"],
  ])("renders %s fils as %s", (input, expected) => {
    expect(Money.toDecimalString(input)).toBe(expected);
  });

  it.each([
    [340050n, "AED 3,400.50"],
    [123456789n, "AED 1,234,567.89"],
    [-120025n, "AED -1,200.25"],
    [5n, "AED 0.05"],
    [0n, "AED 0.00"],
  ])("formats %s fils as %s", (input, expected) => {
    expect(Money.format(input)).toBe(expected);
  });

  it("honours format options", () => {
    expect(Money.format(340050n, { currency: null })).toBe("3,400.50");
    expect(Money.format(340050n, { grouping: false })).toBe("AED 3400.50");
    expect(Money.format(340050n, { currency: "د.إ" })).toBe("د.إ 3,400.50");
  });

  it("round-trips through parse for 1,000 seeded values", () => {
    const random = mulberry32(42);
    for (let i = 0; i < 1000; i += 1) {
      const sign = random() < 0.2 ? -1n : 1n;
      const amount = sign * BigInt(Math.floor(random() * 100_000_000));
      expect(Money.parse(Money.toDecimalString(amount))).toBe(amount);
      expect(Money.parse(Money.format(amount))).toBe(amount);
    }
  });

  it("converts to a lossy number for exports", () => {
    expect(Money.toAedNumber(340050n)).toBe(3400.5);
    expect(Money.toAedNumber(-120025n)).toBe(-1200.25);
  });
});

// ---------------------------------------------------------------------------
// SOW regression anchors — the only externally verifiable numbers we have
// ---------------------------------------------------------------------------

describe("SOW worked examples", () => {
  it("§8: supplier 2,400 / customer 3,500 / 36 months", () => {
    const supplierMonthly = Money.parse("2400");
    const customerMonthly = Money.parse("3500");

    const monthlyGross = Money.subtract(customerMonthly, supplierMonthly);
    expect(Money.format(monthlyGross)).toBe("AED 1,100.00");

    const totalGross = Money.multiply(monthlyGross, 36);
    expect(Money.format(totalGross)).toBe("AED 39,600.00");
  });

  it("Key Financial Logic table: supplier 2,300 / customer 3,400 / insurance 2,500", () => {
    const supplierMonthly = Money.parse("2300");
    const customerMonthly = Money.parse("3400");
    const annualInsurance = Money.parse("2500");

    const monthlyGross = Money.subtract(customerMonthly, supplierMonthly);
    expect(Money.format(monthlyGross)).toBe("AED 1,100.00");

    const annualRentalRevenue = Money.multiply(customerMonthly, 12);
    expect(Money.format(annualRentalRevenue)).toBe("AED 40,800.00");

    const firstYearRevenue = Money.add(annualRentalRevenue, annualInsurance);
    expect(Money.format(firstYearRevenue)).toBe("AED 43,300.00");
  });
});
