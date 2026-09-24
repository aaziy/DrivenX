import { describe, expect, it } from "vitest";

import {
  allowedFineTransitions,
  assertFineTransition,
  canTransitionFine,
  COSTED_FINE_STATUSES,
  defaultFinePayer,
  FINE_STATUSES,
  IllegalFineTransitionError,
  isFineStatus,
  type FineStatus,
} from "./status";

describe("the fine status machine", () => {
  it("allows every legal move and refuses every other one", () => {
    const legal = new Set<string>();
    for (const from of FINE_STATUSES) {
      for (const to of allowedFineTransitions(from)) legal.add(`${from}->${to}`);
    }

    // The full square, so a transition added to the table without thought fails here.
    for (const from of FINE_STATUSES) {
      for (const to of FINE_STATUSES) {
        expect(canTransitionFine(from, to), `${from} -> ${to}`).toBe(legal.has(`${from}->${to}`));
      }
    }
  });

  it("never lets a fine move to itself", () => {
    for (const status of FINE_STATUSES) {
      expect(canTransitionFine(status, status), status).toBe(false);
    }
  });

  it("treats a fine the customer settled themselves as finished", () => {
    expect(allowedFineTransitions("PAID_BY_CUSTOMER")).toEqual([]);
    expect(allowedFineTransitions("CANCELLED")).toEqual([]);
  });

  it("only asks about recovery once DrivenX is out of pocket", () => {
    expect(canTransitionFine("OPEN", "RECOVERED")).toBe(false);
    expect(canTransitionFine("OPEN", "WAIVED")).toBe(false);
    expect(canTransitionFine("DISPUTED", "RECOVERED")).toBe(false);
    expect(canTransitionFine("PAID", "RECOVERED")).toBe(true);
    expect(canTransitionFine("PAID", "WAIVED")).toBe(true);
  });

  it("lets a recovery be undone, so an invoice raised on the wrong contract can be redone", () => {
    expect(canTransitionFine("RECOVERED", "PAID")).toBe(true);
    expect(canTransitionFine("WAIVED", "PAID")).toBe(true);
  });

  it("never lets a customer-settled fine become a cost", () => {
    for (const status of COSTED_FINE_STATUSES) {
      expect(canTransitionFine("PAID_BY_CUSTOMER", status as FineStatus)).toBe(false);
    }
  });

  it("counts a fine as a cost exactly once DrivenX has paid it", () => {
    expect(COSTED_FINE_STATUSES).toEqual(["PAID", "RECOVERED", "WAIVED"]);
    expect(COSTED_FINE_STATUSES).not.toContain("PAID_BY_CUSTOMER");
    expect(COSTED_FINE_STATUSES).not.toContain("CANCELLED");
  });

  it("throws with both ends named, so the message says what was refused", () => {
    expect(() => assertFineTransition("CANCELLED", "PAID")).toThrow(IllegalFineTransitionError);
    try {
      assertFineTransition("CANCELLED", "PAID");
    } catch (error) {
      expect(error).toMatchObject({ from: "CANCELLED", to: "PAID" });
    }
    expect(() => assertFineTransition("OPEN", "PAID")).not.toThrow();
  });

  it("recognises its own statuses and nothing else", () => {
    expect(isFineStatus("PAID")).toBe(true);
    expect(isFineStatus("paid")).toBe(false);
    expect(isFineStatus("SETTLED")).toBe(false);
  });
});

describe("who a fine falls to", () => {
  it("is the customer when the car was out with one, and DrivenX when it was not", () => {
    expect(defaultFinePayer(true)).toBe("CUSTOMER");
    expect(defaultFinePayer(false)).toBe("COMPANY");
  });
});
