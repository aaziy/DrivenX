/**
 * The traffic fine status machine (P2-07, SOW §13).
 *
 * A fine arrives addressed to the car, because the car is registered to DrivenX whoever
 * was driving it. What happens next is two separate questions, and the states keep them
 * apart: who paid the authority, and whether that money is coming back.
 *
 * The distinction matters because the ledger follows money, not blame. A fine the
 * customer settles directly with the authority never touches DrivenX's books — no cost,
 * no revenue, nothing to report — while one DrivenX pays is a cost from that day, and
 * stays a cost until it is actually recharged. Booking a recovery the moment someone is
 * declared liable would report profit DrivenX has not collected and may never collect.
 */

export const FINE_STATUSES = [
  /** Recorded, nothing settled. */
  "OPEN",
  /** Contested with the authority. */
  "DISPUTED",
  /** Overturned, or withdrawn. Nothing is owed by anyone. */
  "CANCELLED",
  /** The customer settled it with the authority themselves. Never touches the ledger. */
  "PAID_BY_CUSTOMER",
  /** DrivenX paid the authority. A cost from that day. */
  "PAID",
  /** DrivenX paid and has recharged the customer. */
  "RECOVERED",
  /** DrivenX paid and decided not to recharge. The cost stays. */
  "WAIVED",
] as const;

export type FineStatus = (typeof FINE_STATUSES)[number];

const TRANSITIONS: Record<FineStatus, readonly FineStatus[]> = {
  OPEN: ["DISPUTED", "CANCELLED", "PAID", "PAID_BY_CUSTOMER"],
  // A dispute ends in the fine standing or being thrown out.
  DISPUTED: ["OPEN", "CANCELLED", "PAID", "PAID_BY_CUSTOMER"],
  CANCELLED: [],
  PAID_BY_CUSTOMER: [],
  // Once DrivenX is out of pocket, the only question left is whether it comes back.
  PAID: ["RECOVERED", "WAIVED"],
  // Recovery can be undone — an invoice raised against the wrong contract — which puts
  // the fine back to paid and not yet recovered, where it can be recharged correctly.
  RECOVERED: ["PAID"],
  WAIVED: ["PAID"],
};

/** DrivenX has paid the authority, so the fine is a cost on its books. */
export const COSTED_FINE_STATUSES: readonly FineStatus[] = ["PAID", "RECOVERED", "WAIVED"];

/** Still to be resolved: these are what an operations screen chases. */
export const OPEN_FINE_STATUSES: readonly FineStatus[] = ["OPEN", "DISPUTED", "PAID"];

export function isFineStatus(value: string): value is FineStatus {
  return (FINE_STATUSES as readonly string[]).includes(value);
}

export function allowedFineTransitions(from: FineStatus): readonly FineStatus[] {
  return TRANSITIONS[from];
}

export function canTransitionFine(from: FineStatus, to: FineStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalFineTransitionError extends Error {
  constructor(
    readonly from: FineStatus,
    readonly to: FineStatus,
  ) {
    super(`A fine cannot move from ${from} to ${to}`);
    this.name = "IllegalFineTransitionError";
  }
}

export function assertFineTransition(from: FineStatus, to: FineStatus): void {
  if (!canTransitionFine(from, to)) throw new IllegalFineTransitionError(from, to);
}

export type FinePayer = "CUSTOMER" | "COMPANY";

/**
 * Who a fine falls to, before anyone overrides it.
 *
 * The car was either out with a customer when the offence happened or it was not, and
 * that is the whole of the default. A fine incurred while the car sat in the yard —
 * a lapsed registration, a parking ticket at the office — is DrivenX's own.
 *
 * Deliberately not a policy setting: the client has not given one (PROJECT_PLAN §8 Q6),
 * and a configurable default would be a guess with a settings screen around it. Staff
 * can change the payer on any fine.
 */
export function defaultFinePayer(wasOnContract: boolean): FinePayer {
  return wasOnContract ? "CUSTOMER" : "COMPANY";
}
