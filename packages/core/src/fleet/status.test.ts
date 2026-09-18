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
 * The legal transitions, written out independently of the implementation.
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

const PAIRS = VEHICLE_STATUSES.flatMap((from) =>
  VEHICLE_STATUSES.map((to) => [from, to] as [VehicleStatus, VehicleStatus]),
);

describe("vehicle status transitions", () => {
  it("covers the full 9 × 9 matrix", () => {
    expect(VEHICLE_STATUSES).toHaveLength(9);
    expect(PAIRS).toHaveLength(81);
  });

  it.each(PAIRS)("%s → %s matches the specification", (from, to) => {
    const legal = LEGAL.has(`${from}>${to}`);

    expect(canTransition(from, to)).toBe(legal);

    if (legal) {
      expect(() => assertTransition(from, to)).not.toThrow();
    } else {
      expect(() => assertTransition(from, to)).toThrow(IllegalVehicleTransitionError);
    }
  });

  it("never treats staying put as a transition", () => {
    for (const status of VEHICLE_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
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
    expect(() => assertTransition(from, to)).toThrow(IllegalVehicleTransitionError);
  });

  it("names both ends of a refused transition, so the message can say what was tried", () => {
    try {
      assertTransition("SOLD", "RENTED");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalVehicleTransitionError);
      expect((error as IllegalVehicleTransitionError).from).toBe("SOLD");
      expect((error as IllegalVehicleTransitionError).to).toBe("RENTED");
    }
  });

  it("makes Sold the only terminal status", () => {
    expect(VEHICLE_STATUSES.filter(isTerminal)).toEqual(["SOLD"]);
  });

  it("leaves no status unreachable except the starting one", () => {
    // A status nothing can move into is dead code in the table — or a missing rule.
    const reachable = new Set(VEHICLE_STATUSES.flatMap((s) => allowedTransitions(s)));
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
