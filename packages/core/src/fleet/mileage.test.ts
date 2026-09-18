import { describe, expect, it } from "vitest";

import { excessKilometres, MAX_PLAUSIBLE_MILEAGE_KM, validateMileageReading } from "./mileage";

describe("validateMileageReading", () => {
  it("accepts a reading that moves forward", () => {
    expect(validateMileageReading(42_000, 43_150)).toEqual({ valid: true });
  });

  it("accepts the same reading again — the car has not gone backwards", () => {
    expect(validateMileageReading(42_000, 42_000)).toEqual({ valid: true });
  });

  it("refuses a reading lower than the last, and says what the last one was", () => {
    // Excess mileage is settled against this at return; a backwards reading is lost money.
    expect(validateMileageReading(42_000, 41_999)).toEqual({
      valid: false,
      code: "backwards",
      params: { current: 42_000 },
    });
  });

  it.each([
    [1.5, "notWholeNumber"],
    [-1, "negative"],
    [MAX_PLAUSIBLE_MILEAGE_KM + 1, "implausible"],
  ] as const)("refuses %s as %s", (reading, code) => {
    const result = validateMileageReading(0, reading);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe(code);
  });

  it("accepts a brand-new car at zero", () => {
    expect(validateMileageReading(0, 0)).toEqual({ valid: true });
  });
});

describe("excessKilometres", () => {
  it("is the distance beyond the allowance", () => {
    expect(excessKilometres(10_000, 45_000, 30_000)).toBe(5_000);
  });

  it("is never negative when the allowance was not used up", () => {
    expect(excessKilometres(10_000, 20_000, 30_000)).toBe(0);
  });
});
