import { describe, expect, it } from "vitest";

import { formatPartyCode, parsePartyCode } from "./codes";

describe("formatPartyCode", () => {
  it("prefixes by kind and pads to five digits", () => {
    expect(formatPartyCode("customer", 1)).toBe("CUS-00001");
    expect(formatPartyCode("supplier", 42)).toBe("SUP-00042");
    expect(formatPartyCode("customer", 99999)).toBe("CUS-99999");
  });

  it("grows rather than truncating past the padded width", () => {
    // Truncating would mint a duplicate of an existing code — a far worse outcome than
    // a wider column.
    expect(formatPartyCode("customer", 100000)).toBe("CUS-100000");
    expect(formatPartyCode("customer", 1234567)).toBe("CUS-1234567");
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses %s", (sequence) => {
    expect(() => formatPartyCode("customer", sequence)).toThrow(RangeError);
  });
});

describe("parsePartyCode", () => {
  it("round-trips everything format produces", () => {
    for (const sequence of [1, 42, 99999, 100000]) {
      expect(parsePartyCode(formatPartyCode("customer", sequence))).toEqual({
        kind: "customer",
        sequence,
      });
    }
  });

  it("accepts what someone would actually type into a search box", () => {
    // Staff type the code from memory: lower case, a space, or no separator at all.
    expect(parsePartyCode("cus-00042")).toEqual({ kind: "customer", sequence: 42 });
    expect(parsePartyCode("CUS 42")).toEqual({ kind: "customer", sequence: 42 });
    expect(parsePartyCode("SUP7")).toEqual({ kind: "supplier", sequence: 7 });
    expect(parsePartyCode("  CUS-00042  ")).toEqual({ kind: "customer", sequence: 42 });
  });

  it.each([
    ["VEH-00001", "a prefix that is not a party"],
    ["CUS-", "no number"],
    ["CUS-00000", "sequences start at one"],
    ["Ahmed", "an ordinary name search"],
    ["0501234567", "a mobile number"],
    ["", "empty"],
  ])("returns null for %s (%s)", (input) => {
    expect(parsePartyCode(input)).toBeNull();
  });
});
