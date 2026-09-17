import { describe, expect, it } from "vitest";

import {
  formatEmiratesId,
  isValidEmiratesId,
  isValidIban,
  isValidTrn,
  isValidUaeMobile,
  isValidVin,
  luhnCheckDigit,
  normaliseUaeMobile,
  vinCheckCharacter,
} from "./identifiers";

describe("Emirates ID", () => {
  it("computes Luhn against the canonical example", () => {
    // 79927398713 is the textbook Luhn number; the digit over 7992739871 is 3.
    expect(luhnCheckDigit("7992739871")).toBe(3);
  });

  it("accepts a valid ID in either form", () => {
    expect(isValidEmiratesId("784-1990-1000000-0")).toBe(true);
    expect(isValidEmiratesId("784199010000000")).toBe(true);
  });

  it("rejects a single mistyped digit", () => {
    // The whole point of the check digit: a slip of one key is caught at entry, not
    // when someone tries to match the ID against a scanned document months later.
    expect(isValidEmiratesId("784-1990-1000001-0")).toBe(false);
  });

  it.each([
    ["784-1990-1000000-1", "wrong check digit"],
    ["123-1990-1000000-4", "does not start 784"],
    ["784-1990-100000-0", "too short"],
    ["", "empty"],
  ])("rejects %s (%s)", (value) => {
    expect(isValidEmiratesId(value)).toBe(false);
  });

  it("formats a valid ID and refuses an invalid one", () => {
    expect(formatEmiratesId("784199010000000")).toBe("784-1990-1000000-0");
    expect(formatEmiratesId("784199010000001")).toBeNull();
  });
});

describe("UAE mobile numbers", () => {
  it.each([
    "+971501234567",
    "971501234567",
    "0501234567",
    "050 123 4567",
    "+971 50 123 4567",
    "(050) 123-4567",
  ])("reduces %s to one stored form", (input) => {
    // Otherwise the same person is three customers and global search misses two of them.
    expect(normaliseUaeMobile(input)).toBe("+971501234567");
  });

  it("accepts every operator prefix in use", () => {
    for (const prefix of ["50", "52", "54", "55", "56", "58"]) {
      expect(isValidUaeMobile(`0${prefix}1234567`)).toBe(true);
    }
  });

  it.each([
    ["0511234567", "51 is not an operator prefix"],
    ["050123456", "too short"],
    ["05012345678", "too long"],
    ["+441234567890", "not a UAE number"],
    ["", "empty"],
  ])("rejects %s (%s)", (value) => {
    expect(isValidUaeMobile(value)).toBe(false);
  });
});

describe("TRN", () => {
  it("accepts 15 digits and ignores spacing", () => {
    expect(isValidTrn("100123456789012")).toBe(true);
    expect(isValidTrn("100 123 456 789 012")).toBe(true);
  });

  it.each(["10012345678901", "1001234567890123", "10012345678901A", ""])(
    "rejects %s",
    (value) => {
      expect(isValidTrn(value)).toBe(false);
    },
  );
});

describe("VIN", () => {
  it("accepts VINs published as valid examples", () => {
    // External ground truth rather than our own arithmetic checking itself.
    expect(isValidVin("1M8GDM9AXKP042788")).toBe(true);
    expect(isValidVin("1HGCM82633A004352")).toBe(true);
  });

  it("computes the check character at position nine", () => {
    expect(vinCheckCharacter("1M8GDM9AXKP042788")).toBe("X");
  });

  it("rejects a tampered VIN", () => {
    expect(isValidVin("1M8GDM9AXKP042789")).toBe(false);
  });

  it.each([
    ["1M8GDM9AXKP04278", "too short"],
    ["1M8GDM9AIKP042788", "contains I"],
    ["1M8GDM9AOKP042788", "contains O"],
    ["1M8GDM9AQKP042788", "contains Q"],
    ["", "empty"],
  ])("rejects %s (%s)", (value) => {
    expect(isValidVin(value)).toBe(false);
  });

  it("is case-insensitive, because people type plates and VINs in lower case", () => {
    expect(isValidVin("1m8gdm9axkp042788")).toBe(true);
  });
});

describe("IBAN", () => {
  it("accepts a published UAE example", () => {
    expect(isValidIban("AE070331234567890123456")).toBe(true);
  });

  it("ignores the spacing banks print", () => {
    expect(isValidIban("AE07 0331 2345 6789 0123 456")).toBe(true);
  });

  it.each([
    ["AE070331234567890123457", "one digit changed"],
    ["AE07033123456789012345", "too short"],
    ["GB82WEST12345698765432", "not a UAE IBAN"],
    ["", "empty"],
  ])("rejects %s (%s)", (value) => {
    expect(isValidIban(value)).toBe(false);
  });
});
