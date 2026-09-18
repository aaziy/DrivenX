import { describe, expect, it } from "vitest";

import {
  allowedContractTransitions,
  assertContractTransition,
  canTransitionContract,
  CONTRACT_STATUSES,
  IllegalContractTransitionError,
  type ContractStatus,
} from "./status";

/** The specification, written out by hand rather than derived from the table under test. */
const LEGAL = new Set<string>([
  "DRAFT>PENDING",
  "DRAFT>ACTIVE",
  "DRAFT>CANCELLED",
  "PENDING>ACTIVE",
  "PENDING>DRAFT",
  "PENDING>CANCELLED",
  "ACTIVE>OVERDUE",
  "ACTIVE>COMPLETED",
  "ACTIVE>CANCELLED",
  "OVERDUE>ACTIVE",
  "OVERDUE>COMPLETED",
  "OVERDUE>CANCELLED",
]);

const PAIRS = CONTRACT_STATUSES.flatMap((from) =>
  CONTRACT_STATUSES.map((to) => [from, to] as [ContractStatus, ContractStatus]),
);

describe("contract status transitions", () => {
  it.each(PAIRS)("%s → %s matches the specification", (from, to) => {
    const legal = LEGAL.has(`${from}>${to}`);
    expect(canTransitionContract(from, to)).toBe(legal);
    if (!legal) {
      expect(() => assertContractTransition(from, to)).toThrow(IllegalContractTransitionError);
    }
  });

  it("makes Completed and Cancelled final", () => {
    expect(allowedContractTransitions("COMPLETED")).toEqual([]);
    expect(allowedContractTransitions("CANCELLED")).toEqual([]);
  });

  it("never reopens a cancelled contract", () => {
    expect(() => assertContractTransition("CANCELLED", "ACTIVE")).toThrow(IllegalContractTransitionError);
  });
});
