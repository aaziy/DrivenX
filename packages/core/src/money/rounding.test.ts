import { describe, expect, it } from "vitest";

import { divideRound, RoundingMode } from "./rounding";

describe("divideRound", () => {
  it("is exact when there is no remainder", () => {
    expect(divideRound(100n, 4n)).toBe(25n);
    expect(divideRound(-100n, 4n)).toBe(-25n);
    expect(divideRound(0n, 7n)).toBe(0n);
  });

  describe("DOWN — toward zero", () => {
    it.each([
      [29n, 10n, 2n],
      [-29n, 10n, -2n],
      [25n, 10n, 2n],
    ])("divideRound(%s, %s) === %s", (a, b, expected) => {
      expect(divideRound(a, b, RoundingMode.DOWN)).toBe(expected);
    });
  });

  describe("UP — away from zero", () => {
    it.each([
      [21n, 10n, 3n],
      [-21n, 10n, -3n],
      [20n, 10n, 2n],
    ])("divideRound(%s, %s) === %s", (a, b, expected) => {
      expect(divideRound(a, b, RoundingMode.UP)).toBe(expected);
    });
  });

  describe("HALF_UP — ties away from zero (default)", () => {
    it.each([
      [25n, 10n, 3n],
      [-25n, 10n, -3n],
      [24n, 10n, 2n],
      [-24n, 10n, -2n],
      [26n, 10n, 3n],
    ])("divideRound(%s, %s) === %s", (a, b, expected) => {
      expect(divideRound(a, b, RoundingMode.HALF_UP)).toBe(expected);
    });

    it("is the default mode", () => {
      expect(divideRound(25n, 10n)).toBe(divideRound(25n, 10n, RoundingMode.HALF_UP));
    });
  });

  describe("HALF_EVEN — ties to even", () => {
    it.each([
      [25n, 10n, 2n], // 2.5 -> 2
      [35n, 10n, 4n], // 3.5 -> 4
      [-25n, 10n, -2n],
      [-35n, 10n, -4n],
      [26n, 10n, 3n], // not a tie
    ])("divideRound(%s, %s) === %s", (a, b, expected) => {
      expect(divideRound(a, b, RoundingMode.HALF_EVEN)).toBe(expected);
    });
  });

  it("treats sign symmetrically across all modes", () => {
    for (const mode of Object.values(RoundingMode)) {
      for (const numerator of [1n, 7n, 25n, 99n, 100n]) {
        expect(divideRound(-numerator, 10n, mode)).toBe(-divideRound(numerator, 10n, mode));
      }
    }
  });

  it("handles a negative denominator", () => {
    expect(divideRound(25n, -10n, RoundingMode.HALF_UP)).toBe(-3n);
    expect(divideRound(-25n, -10n, RoundingMode.HALF_UP)).toBe(3n);
  });

  it("rejects division by zero", () => {
    expect(() => divideRound(1n, 0n)).toThrow(RangeError);
  });
});
