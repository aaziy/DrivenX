import { describe, expect, it } from "vitest";

import {
  assertLeadTransition,
  IllegalLeadTransitionError,
  isOpenLead,
  LEAD_STATUSES,
  manualLeadTransitions,
} from "./status";

describe("the lead pipeline", () => {
  it("moves forward one stage or more, and out to Lost from any open stage", () => {
    expect(() => assertLeadTransition("NEW", "CONTACTED")).not.toThrow();
    expect(() => assertLeadTransition("NEW", "QUALIFIED")).not.toThrow();
    for (const open of ["NEW", "CONTACTED", "QUALIFIED", "DEAL_CREATED"] as const) {
      expect(() => assertLeadTransition(open, "LOST")).not.toThrow();
    }
  });

  it("refuses to skip to a deal or a contract without one", () => {
    expect(() => assertLeadTransition("NEW", "CONTRACTED")).toThrow(IllegalLeadTransitionError);
    expect(() => assertLeadTransition("CONTACTED", "DEAL_CREATED")).toThrow(IllegalLeadTransitionError);
  });

  it("never offers the earned stages by hand", () => {
    for (const from of LEAD_STATUSES) {
      expect(manualLeadTransitions(from)).not.toContain("DEAL_CREATED");
      expect(manualLeadTransitions(from)).not.toContain("CONTRACTED");
    }
    expect(manualLeadTransitions("QUALIFIED")).toEqual(["CONTACTED", "LOST"]);
  });

  it("treats Contracted as final and lets a lost lead be reopened", () => {
    expect(manualLeadTransitions("CONTRACTED")).toEqual([]);
    expect(manualLeadTransitions("LOST")).toEqual(["NEW", "CONTACTED"]);
    expect(isOpenLead("CONTRACTED")).toBe(false);
    expect(isOpenLead("LOST")).toBe(false);
    expect(isOpenLead("DEAL_CREATED")).toBe(true);
  });
});
