import { describe, expect, it } from "vitest";

import {
  allowedTransitions,
  assertTransition,
  canTransition,
  IllegalVehicleTransitionError,
  isTerminal,
  isVehicleStatus,
  VEHICLE_STATUSES,
  type VehicleStatus,
} from "./status";

/**
 * The legal transitions for a car DrivenX owns, written out independently of the
 * implementation.
 *
 * Deriving the expectation from the implementation's own table would test nothing: a
 * wrong entry would be faithfully expected. This list is the specification, restated by
 * hand, and every one of the 81 pairs is checked against it.
 */
const LEGAL = new Set<string>([
  "AVAILABLE>RESERVED",
  "AVAILABLE>RENTED",
  "AVAILABLE>LEASE_TO_OWN",
  "AVAILABLE>MAINTENANCE",
  "AVAILABLE>ACCIDENT",
  "AVAILABLE>SOLD",
  "AVAILABLE>INACTIVE",
  "RESERVED>AVAILABLE",
  "RESERVED>RENTED",
  "RESERVED>LEASE_TO_OWN",
  "RENTED>RETURNED",
  "RENTED>ACCIDENT",
  "LEASE_TO_OWN>RETURNED",
  "LEASE_TO_OWN>SOLD",
  "LEASE_TO_OWN>ACCIDENT",
  "MAINTENANCE>AVAILABLE",
  "MAINTENANCE>INACTIVE",
  "ACCIDENT>MAINTENANCE",
  "ACCIDENT>INACTIVE",
  "ACCIDENT>SOLD",
  "RETURNED>AVAILABLE",
  "RETURNED>MAINTENANCE",
  "RETURNED>ACCIDENT",
  "INACTIVE>AVAILABLE",
  "INACTIVE>SOLD",
]);

/**
 * A car leased in from a supplier: everything above except a plain rental, and except
 * a sale that is not the end of a lease-to-own. Also written out by hand.
 */
const FORBIDDEN_WHEN_LEASED_IN = new Set<string>([
  "AVAILABLE>RENTED",
  "RESERVED>RENTED",
  "AVAILABLE>SOLD",
  "ACCIDENT>SOLD",
  "INACTIVE>SOLD",
]);

const PAIRS = VEHICLE_STATUSES.flatMap((from) =>
  VEHICLE_STATUSES.map((to) => [from, to] as [VehicleStatus, VehicleStatus]),
);

describe("vehicle status transitions — a car DrivenX owns", () => {
  it("covers the full 9 × 9 matrix", () => {
    expect(VEHICLE_STATUSES).toHaveLength(9);
    expect(PAIRS).toHaveLength(81);
  });

  it.each(PAIRS)("%s → %s matches the specification", (from, to) => {
    const legal = LEGAL.has(`${from}>${to}`);

    expect(canTransition(from, to, "COMPANY_OWNED")).toBe(legal);

    if (legal) {
      expect(() => assertTransition(from, to, "COMPANY_OWNED")).not.toThrow();
    } else {
      expect(() => assertTransition(from, to, "COMPANY_OWNED")).toThrow(
        IllegalVehicleTransitionError,
      );
    }
  });

  it("never treats staying put as a transition", () => {
    for (const status of VEHICLE_STATUSES) {
      expect(canTransition(status, status, "COMPANY_OWNED")).toBe(false);
    }
  });

  // The QA negatives named in the plan, stated as cases so a reader can find them.
  const namedRefusals: Array<[VehicleStatus, VehicleStatus, string]> = [
    ["SOLD", "RENTED", "a sold car cannot go back on a rental"],
    ["SOLD", "AVAILABLE", "a sale is not undone by a status change"],
    ["MAINTENANCE", "RENTED", "a car in the workshop cannot be handed to a customer"],
    ["RENTED", "AVAILABLE", "a car on contract must be returned and inspected first"],
    ["LEASE_TO_OWN", "AVAILABLE", "nobody can be offered a car someone else is buying"],
    ["ACCIDENT", "AVAILABLE", "a damaged car must be repaired before it is let again"],
  ];

  it.each(namedRefusals)("refuses %s → %s: %s", (from, to) => {
    expect(() => assertTransition(from, to, "COMPANY_OWNED")).toThrow(
      IllegalVehicleTransitionError,
    );
  });

  it("names both ends of a refused transition, so the message can say what was tried", () => {
    try {
      assertTransition("SOLD", "RENTED", "COMPANY_OWNED");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalVehicleTransitionError);
      expect((error as IllegalVehicleTransitionError).from).toBe("SOLD");
      expect((error as IllegalVehicleTransitionError).to).toBe("RENTED");
      expect((error as IllegalVehicleTransitionError).blockedByOwnership).toBe(false);
    }
  });

  it("makes Sold the only terminal status", () => {
    expect(VEHICLE_STATUSES.filter(isTerminal)).toEqual(["SOLD"]);
  });

  it("leaves no status unreachable", () => {
    // A status nothing can move into is dead code in the table — or a missing rule.
    const reachable = new Set(
      VEHICLE_STATUSES.flatMap((s) => allowedTransitions(s, "COMPANY_OWNED")),
    );
    for (const status of VEHICLE_STATUSES) {
      expect(reachable.has(status), status).toBe(true);
    }
  });

  it("recognises its own statuses and nothing else", () => {
    expect(isVehicleStatus("RENTED")).toBe(true);
    expect(isVehicleStatus("rented")).toBe(false);
    expect(isVehicleStatus("STOLEN")).toBe(false);
  });
});

describe("vehicle status transitions — a car leased in from a supplier", () => {
  it.each(PAIRS)("%s → %s matches the specification", (from, to) => {
    const pair = `${from}>${to}`;
    const legal = LEGAL.has(pair) && !FORBIDDEN_WHEN_LEASED_IN.has(pair);

    expect(canTransition(from, to, "B2B_SUPPLIER")).toBe(legal);
  });

  it("never goes on a plain rental", () => {
    expect(allowedTransitions("AVAILABLE", "B2B_SUPPLIER")).not.toContain("RENTED");
    expect(allowedTransitions("RESERVED", "B2B_SUPPLIER")).not.toContain("RENTED");
  });

  it("goes to a customer on lease-to-own", () => {
    expect(canTransition("AVAILABLE", "LEASE_TO_OWN", "B2B_SUPPLIER")).toBe(true);
    expect(canTransition("RESERVED", "LEASE_TO_OWN", "B2B_SUPPLIER")).toBe(true);
  });

  it("is sold only as the end of a lease-to-own", () => {
    // The buyout is the one way it changes hands.
    expect(canTransition("LEASE_TO_OWN", "SOLD", "B2B_SUPPLIER")).toBe(true);
    for (const from of ["AVAILABLE", "ACCIDENT", "INACTIVE"] as const) {
      expect(canTransition(from, "SOLD", "B2B_SUPPLIER"), from).toBe(false);
    }
  });

  it("says ownership is why, when ownership is why", () => {
    try {
      assertTransition("AVAILABLE", "RENTED", "B2B_SUPPLIER");
      expect.unreachable();
    } catch (error) {
      expect((error as IllegalVehicleTransitionError).blockedByOwnership).toBe(true);
    }

    // Illegal for any car: ownership is not the reason, and the message must not say so.
    try {
      assertTransition("SOLD", "RENTED", "B2B_SUPPLIER");
      expect.unreachable();
    } catch (error) {
      expect((error as IllegalVehicleTransitionError).blockedByOwnership).toBe(false);
    }
  });
});
