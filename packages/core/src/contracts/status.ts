/**
 * The contract status machine (P1D-02, SOW §9).
 *
 * Draft → Pending → Active → Completed, with Overdue as a state an active contract falls
 * into and climbs back out of, and Cancelled as a way out before activation.
 *
 * Active → Cancelled is allowed because a contract can end early, but what is then owed
 * is still an open client question (PROJECT_PLAN §8 Q3). The status can move; the
 * settlement that should accompany it is not built until that is answered.
 */

export const CONTRACT_STATUSES = [
  "DRAFT",
  "PENDING",
  "ACTIVE",
  "OVERDUE",
  "COMPLETED",
  "CANCELLED",
] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

const TRANSITIONS: Record<ContractStatus, readonly ContractStatus[]> = {
  DRAFT: ["PENDING", "ACTIVE", "CANCELLED"],
  // Approved, sent back for changes, or dropped.
  PENDING: ["ACTIVE", "DRAFT", "CANCELLED"],
  ACTIVE: ["OVERDUE", "COMPLETED", "CANCELLED"],
  // Paid up, or ended while still owing.
  OVERDUE: ["ACTIVE", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/** A contract in these statuses holds its vehicle and has a live payment schedule. */
export const LIVE_CONTRACT_STATUSES: readonly ContractStatus[] = ["ACTIVE", "OVERDUE"];

/** Terms can be edited only before the schedule exists. */
export const EDITABLE_CONTRACT_STATUSES: readonly ContractStatus[] = ["DRAFT", "PENDING"];

export function isContractStatus(value: string): value is ContractStatus {
  return (CONTRACT_STATUSES as readonly string[]).includes(value);
}

export function allowedContractTransitions(from: ContractStatus): readonly ContractStatus[] {
  return TRANSITIONS[from];
}

export function canTransitionContract(from: ContractStatus, to: ContractStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalContractTransitionError extends Error {
  constructor(
    readonly from: ContractStatus,
    readonly to: ContractStatus,
  ) {
    super(`A contract cannot move from ${from} to ${to}`);
    this.name = "IllegalContractTransitionError";
  }
}

export function assertContractTransition(from: ContractStatus, to: ContractStatus): void {
  if (!canTransitionContract(from, to)) throw new IllegalContractTransitionError(from, to);
}
