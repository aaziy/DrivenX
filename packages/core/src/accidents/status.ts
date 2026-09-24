/**
 * Accidents and the claims that follow them (P2-09, P2-10, SOW §13).
 *
 * Two machines, because a crash and a claim move at different speeds and neither waits
 * for the other. A car can be back on the road weeks before the insurer decides
 * anything, and a claim can be refused long after the repair has been paid for, so tying
 * them into one status would mean a car stuck in a state it is no longer in.
 *
 * What they share is the rule the ledger cares about: repairing a car costs money on the
 * day the work is billed, and a claim brings money in on the day it actually arrives.
 * Neither anticipates the other. An approved claim is not cash — insurers refuse, reduce
 * and delay — and booking it as income would report a recovery that may never land.
 */

export const ACCIDENT_STATUSES = [
  /** Logged: it happened, and nothing has been decided.  */
  "REPORTED",
  /** With a garage. */
  "UNDER_REPAIR",
  /** Back on the road, whatever the insurer is still doing. */
  "REPAIRED",
  /** Beyond economic repair. The car's own status is where that is recorded. */
  "WRITTEN_OFF",
  /** Nothing further to do: repairs done and money resolved. */
  "CLOSED",
] as const;

export type AccidentStatus = (typeof ACCIDENT_STATUSES)[number];

const ACCIDENT_TRANSITIONS: Record<AccidentStatus, readonly AccidentStatus[]> = {
  REPORTED: ["UNDER_REPAIR", "WRITTEN_OFF", "CLOSED"],
  UNDER_REPAIR: ["REPAIRED", "WRITTEN_OFF"],
  // Reopened when the same damage comes back from the garage unfixed.
  REPAIRED: ["UNDER_REPAIR", "CLOSED"],
  WRITTEN_OFF: ["CLOSED"],
  CLOSED: [],
};

export function isAccidentStatus(value: string): value is AccidentStatus {
  return (ACCIDENT_STATUSES as readonly string[]).includes(value);
}

export function allowedAccidentTransitions(from: AccidentStatus): readonly AccidentStatus[] {
  return ACCIDENT_TRANSITIONS[from];
}

export function canTransitionAccident(from: AccidentStatus, to: AccidentStatus): boolean {
  return ACCIDENT_TRANSITIONS[from].includes(to);
}

export class IllegalAccidentTransitionError extends Error {
  constructor(
    readonly from: AccidentStatus,
    readonly to: AccidentStatus,
  ) {
    super(`An accident cannot move from ${from} to ${to}`);
    this.name = "IllegalAccidentTransitionError";
  }
}

export function assertAccidentTransition(from: AccidentStatus, to: AccidentStatus): void {
  if (!canTransitionAccident(from, to)) throw new IllegalAccidentTransitionError(from, to);
}

/**
 * Who was at fault.
 *
 * `UNKNOWN` is the honest state for most of a claim's life — the police report decides
 * it, and that takes weeks — so it is the default rather than a guess. Whether DrivenX
 * recharges the customer for the excess is a separate decision, made on the settlement
 * where every other charge to a customer is made.
 */
export const ACCIDENT_RESPONSIBILITIES = ["CUSTOMER", "THIRD_PARTY", "SHARED", "UNKNOWN"] as const;

export type AccidentResponsibility = (typeof ACCIDENT_RESPONSIBILITIES)[number];

export const CLAIM_STATUSES = [
  /** Lodged with the insurer. */
  "LODGED",
  /** The insurer has agreed a figure, which is not the same as having paid it. */
  "APPROVED",
  /** Paid, in full or in part. The only state that brings money in. */
  "SETTLED",
  "REJECTED",
  /** Pulled — usually because the repair came in under the policy excess. */
  "WITHDRAWN",
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

const CLAIM_TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  LODGED: ["APPROVED", "REJECTED", "WITHDRAWN"],
  APPROVED: ["SETTLED", "REJECTED"],
  SETTLED: [],
  // A refusal can be appealed, which puts it back in front of the insurer.
  REJECTED: ["LODGED"],
  WITHDRAWN: ["LODGED"],
};

export function isClaimStatus(value: string): value is ClaimStatus {
  return (CLAIM_STATUSES as readonly string[]).includes(value);
}

export function allowedClaimTransitions(from: ClaimStatus): readonly ClaimStatus[] {
  return CLAIM_TRANSITIONS[from];
}

export function canTransitionClaim(from: ClaimStatus, to: ClaimStatus): boolean {
  return CLAIM_TRANSITIONS[from].includes(to);
}

export class IllegalClaimTransitionError extends Error {
  constructor(
    readonly from: ClaimStatus,
    readonly to: ClaimStatus,
  ) {
    super(`A claim cannot move from ${from} to ${to}`);
    this.name = "IllegalClaimTransitionError";
  }
}

export function assertClaimTransition(from: ClaimStatus, to: ClaimStatus): void {
  if (!canTransitionClaim(from, to)) throw new IllegalClaimTransitionError(from, to);
}

/**
 * What an accident has actually cost DrivenX so far: the repair, less whatever the
 * insurer has genuinely paid. Never less than nothing — an insurer paying more than the
 * repair is a windfall, and the shape of that is a question nobody has asked yet.
 */
export function netAccidentCost(repairNetFils: bigint, claimReceivedFils: bigint): bigint {
  const net = repairNetFils - claimReceivedFils;
  return net > 0n ? net : 0n;
}
