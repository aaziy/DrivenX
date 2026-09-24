import { describe, expect, it } from "vitest";

import {
  ACCIDENT_STATUSES,
  allowedAccidentTransitions,
  allowedClaimTransitions,
  assertAccidentTransition,
  assertClaimTransition,
  canTransitionAccident,
  canTransitionClaim,
  CLAIM_STATUSES,
  IllegalAccidentTransitionError,
  IllegalClaimTransitionError,
  netAccidentCost,
} from "./status";

describe("the accident status machine", () => {
  it("allows every legal move and refuses every other one", () => {
    const legal = new Set<string>();
    for (const from of ACCIDENT_STATUSES) {
      for (const to of allowedAccidentTransitions(from)) legal.add(`${from}->${to}`);
    }
    for (const from of ACCIDENT_STATUSES) {
      for (const to of ACCIDENT_STATUSES) {
        expect(canTransitionAccident(from, to), `${from} -> ${to}`).toBe(legal.has(`${from}->${to}`));
      }
    }
  });

  it("never lets an accident move to itself", () => {
    for (const status of ACCIDENT_STATUSES) {
      expect(canTransitionAccident(status, status), status).toBe(false);
    }
  });

  it("lets a car go back to the garage when the repair did not hold", () => {
    expect(canTransitionAccident("REPAIRED", "UNDER_REPAIR")).toBe(true);
  });

  it("does not let a written-off car be repaired", () => {
    expect(canTransitionAccident("WRITTEN_OFF", "UNDER_REPAIR")).toBe(false);
    expect(canTransitionAccident("WRITTEN_OFF", "REPAIRED")).toBe(false);
    expect(allowedAccidentTransitions("WRITTEN_OFF")).toEqual(["CLOSED"]);
  });

  it("closes for good", () => {
    expect(allowedAccidentTransitions("CLOSED")).toEqual([]);
  });

  it("names both ends when it refuses", () => {
    expect(() => assertAccidentTransition("CLOSED", "UNDER_REPAIR")).toThrow(IllegalAccidentTransitionError);
    expect(() => assertAccidentTransition("REPORTED", "UNDER_REPAIR")).not.toThrow();
  });
});

describe("the claim status machine", () => {
  it("allows every legal move and refuses every other one", () => {
    const legal = new Set<string>();
    for (const from of CLAIM_STATUSES) {
      for (const to of allowedClaimTransitions(from)) legal.add(`${from}->${to}`);
    }
    for (const from of CLAIM_STATUSES) {
      for (const to of CLAIM_STATUSES) {
        expect(canTransitionClaim(from, to), `${from} -> ${to}`).toBe(legal.has(`${from}->${to}`));
      }
    }
  });

  it("will not let a claim be settled before it is approved", () => {
    // Money arriving on a claim nobody agreed is a reconciliation problem, not a shortcut.
    expect(canTransitionClaim("LODGED", "SETTLED")).toBe(false);
    expect(canTransitionClaim("APPROVED", "SETTLED")).toBe(true);
  });

  it("lets a refusal be appealed", () => {
    expect(canTransitionClaim("REJECTED", "LODGED")).toBe(true);
    expect(canTransitionClaim("WITHDRAWN", "LODGED")).toBe(true);
  });

  it("treats a settled claim as final", () => {
    expect(allowedClaimTransitions("SETTLED")).toEqual([]);
  });

  it("names both ends when it refuses", () => {
    expect(() => assertClaimTransition("SETTLED", "LODGED")).toThrow(IllegalClaimTransitionError);
    expect(() => assertClaimTransition("APPROVED", "SETTLED")).not.toThrow();
  });
});

describe("what an accident has cost so far", () => {
  it("is the repair until the insurer pays", () => {
    expect(netAccidentCost(500_000n, 0n)).toBe(500_000n);
  });

  it("is what is left after a part payment", () => {
    // AED 5,000 repair, AED 4,000 paid: the excess is what DrivenX is left carrying.
    expect(netAccidentCost(500_000n, 400_000n)).toBe(100_000n);
  });

  it("is nothing once the insurer has covered it", () => {
    expect(netAccidentCost(500_000n, 500_000n)).toBe(0n);
  });

  it("never goes below nothing", () => {
    expect(netAccidentCost(500_000n, 600_000n)).toBe(0n);
  });
});
