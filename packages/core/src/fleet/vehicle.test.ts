import { describe, expect, it } from "vitest";

import { isPlausibleModelYear, normaliseChassisNumber, normalisePlate } from "./vehicle";

describe("normaliseChassisNumber", () => {
  it("accepts a VIN whatever its check digit", () => {
    // Position 9 is a check digit only in North America. A European or Asian VIN may
    // have anything there, and refusing it would refuse a real car.
    expect(normaliseChassisNumber("WDD2050421F123456")).toBe("WDD2050421F123456");
    expect(normaliseChassisNumber("1M8GDM9AXKP042788")).toBe("1M8GDM9AXKP042788");
  });

  it("accepts a Japanese chassis number, which is not a VIN at all", () => {
    expect(normaliseChassisNumber("GRS200-1234567")).toBe("GRS200-1234567");
    expect(normaliseChassisNumber("zvw30 1234567")).toBe("ZVW301234567");
  });

  it("stores one form however it was typed", () => {
    expect(normaliseChassisNumber("  wdd 2050421f 123456 ")).toBe("WDD2050421F123456");
  });

  it.each([
    ["WDD2050421O123456", "17 characters with an O — a mistyped 0"],
    ["WDD2050421I123456", "17 characters with an I — a mistyped 1"],
    ["ABC", "too short to be either"],
    ["", "empty"],
    ["NOT A CHASSIS NUMBER AT ALL", "prose"],
  ])("refuses %s (%s)", (value) => {
    expect(normaliseChassisNumber(value)).toBeNull();
  });
});

describe("normalisePlate", () => {
  it("accepts a Dubai letter code and an Abu Dhabi number code", () => {
    expect(normalisePlate("a", "12345")).toEqual({ plateCode: "A", plateNumber: "12345" });
    expect(normalisePlate("1", "5")).toEqual({ plateCode: "1", plateNumber: "5" });
  });

  it.each([
    ["", "12345", "no code"],
    ["A", "", "no number"],
    ["A", "123456", "six digits"],
    ["A", "12a45", "a letter in the number"],
    ["ABCD", "12345", "code too long"],
  ])("refuses code %j number %j (%s)", (code, number) => {
    expect(normalisePlate(code, number)).toBeNull();
  });
});

describe("isPlausibleModelYear", () => {
  const now = new Date("2026-09-18T00:00:00Z");

  it("accepts this year and next year's models", () => {
    expect(isPlausibleModelYear(2026, now)).toBe(true);
    expect(isPlausibleModelYear(2027, now)).toBe(true);
  });

  it.each([2028, 1979, 2206, 20.5])("refuses %s", (year) => {
    expect(isPlausibleModelYear(year, now)).toBe(false);
  });
});
