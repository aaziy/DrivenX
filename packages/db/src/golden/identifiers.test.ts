import { describe, expect, it } from "vitest";

import {
  emiratesId,
  goldenId,
  iban,
  isValidEmiratesId,
  isValidIban,
  isValidVin,
  luhnCheckDigit,
  mobileNumber,
  plateNumber,
  tradeLicenceNumber,
  trn,
  vin,
} from "./identifiers";

const INDICES = Array.from({ length: 200 }, (_, i) => i);

describe("determinism", () => {
  it("produces identical values for the same index, every time", () => {
    // The whole point of the golden dataset: a failing test is reproducible.
    for (const index of [0, 1, 7, 42, 199]) {
      expect(emiratesId(index, 1990)).toBe(emiratesId(index, 1990));
      expect(vin(index)).toBe(vin(index));
      expect(iban(index)).toBe(iban(index));
      expect(plateNumber(index)).toBe(plateNumber(index));
      expect(mobileNumber(index)).toBe(mobileNumber(index));
    }
  });

  it("pins a few exact values, so an accidental change to the generator is caught", () => {
    expect(emiratesId(0, 1990)).toBe("784-1990-1000000-0");
    expect(goldenId("cust", 7)).toBe("gold_cust_007");
  });
});

describe("Emirates ID", () => {
  it("has the 784-YYYY-NNNNNNN-C shape", () => {
    expect(emiratesId(5, 1988)).toMatch(/^784-1988-\d{7}-\d$/);
  });

  it("carries a valid Luhn check digit", () => {
    // 1A adds validation for this; data that fails our own validator is worthless.
    for (const index of INDICES) {
      expect(isValidEmiratesId(emiratesId(index, 1985 + (index % 25)))).toBe(true);
    }
  });

  it("rejects an id whose check digit is wrong", () => {
    const valid = emiratesId(3, 1990);
    const digits = valid.replace(/\D/g, "");
    const wrongCheck = `${digits.slice(0, 14)}${(Number(digits[14]) + 1) % 10}`;
    expect(isValidEmiratesId(wrongCheck)).toBe(false);
  });

  it.each(["784-1990-1000000", "123-1990-1000000-4", ""])("rejects %j", (value) => {
    expect(isValidEmiratesId(value)).toBe(false);
  });

  it("computes Luhn correctly against a known value", () => {
    // 79927398713 is the canonical Luhn example; check digit over 7992739871 is 3.
    expect(luhnCheckDigit("7992739871")).toBe(3);
  });

  it("does not collide across the dataset size", () => {
    const values = INDICES.map((index) => emiratesId(index, 1990));
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("VIN", () => {
  it("is 17 characters and excludes I, O and Q", () => {
    for (const index of INDICES) {
      const value = vin(index);
      expect(value).toHaveLength(17);
      expect(value).not.toMatch(/[IOQ]/);
    }
  });

  it("carries a valid mod-11 check character", () => {
    for (const index of INDICES) {
      expect(isValidVin(vin(index))).toBe(true);
    }
  });

  it("rejects a VIN with a tampered check character", () => {
    const value = vin(11);
    const wrong = `${value.slice(0, 8)}${value[8] === "1" ? "2" : "1"}${value.slice(9)}`;
    expect(isValidVin(wrong)).toBe(false);
  });

  it("does not collide", () => {
    const values = INDICES.map(vin);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("IBAN", () => {
  it("is a 23-character UAE IBAN", () => {
    expect(iban(0)).toMatch(/^AE\d{21}$/);
  });

  it("passes mod-97 validation", () => {
    for (const index of INDICES) {
      expect(isValidIban(iban(index))).toBe(true);
    }
  });

  it("rejects a tampered IBAN", () => {
    const value = iban(4);
    const tampered = `${value.slice(0, 5)}${(Number(value[5]) + 1) % 10}${value.slice(6)}`;
    expect(isValidIban(tampered)).toBe(false);
  });
});

describe("plates, mobiles and business identifiers", () => {
  it("produces Dubai-style plates", () => {
    for (const index of INDICES) {
      expect(plateNumber(index)).toMatch(/^[A-J] \d{5}$/);
    }
  });

  it("produces UAE mobiles on real operator prefixes", () => {
    for (const index of INDICES) {
      expect(mobileNumber(index)).toMatch(/^\+9715[024568]\d{7}$/);
    }
  });

  it("produces 15-digit TRNs beginning 100", () => {
    for (const index of INDICES) {
      const value = trn(index);
      expect(value).toMatch(/^100\d{12}$/);
      expect(value).toHaveLength(15);
    }
  });

  it("produces trade licence numbers", () => {
    expect(tradeLicenceNumber(0)).toMatch(/^CN-\d+$/);
  });

  it("does not collide on plates or mobiles", () => {
    expect(new Set(INDICES.map(plateNumber)).size).toBe(INDICES.length);
    expect(new Set(INDICES.map(mobileNumber)).size).toBe(INDICES.length);
  });
});

describe("goldenId", () => {
  it("is stable and zero-padded", () => {
    expect(goldenId("veh", 1)).toBe("gold_veh_001");
    expect(goldenId("veh", 25)).toBe("gold_veh_025");
  });
});
