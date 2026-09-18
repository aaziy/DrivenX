/**
 * The vehicle status state machine (P1B-02, SOW §4).
 *
 * An explicit table of what may follow what, rather than a status column anyone can set to
 * anything. The failure it prevents is quiet and expensive: a sold car put back on a
 * rental, a car under repair handed to a customer, a lease-to-own vehicle marked available
 * while someone is still paying for it. Each of those is one careless dropdown away if the
 * column is free-form.
 *
 * Pure: no database, no clock. The web layer asks `assertTransition` before it writes, and
 * the whole table is tested pair by pair against an independently written matrix.
 */

export const VEHICLE_STATUSES = [
  "AVAILABLE",
  "RESERVED",
  "RENTED",
  "LEASE_TO_OWN",
  "MAINTENANCE",
  "ACCIDENT",
  "RETURNED",
  "SOLD",
  "INACTIVE",
] as const;

export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

const TRANSITIONS: Record<VehicleStatus, readonly VehicleStatus[]> = {
  AVAILABLE: ["RESERVED", "RENTED", "LEASE_TO_OWN", "MAINTENANCE", "ACCIDENT", "SOLD", "INACTIVE"],
  // A reservation either converts or is cancelled; it does not go to the workshop.
  RESERVED: ["AVAILABLE", "RENTED", "LEASE_TO_OWN"],
  // A car out on contract comes back, or is involved in an accident. It does not become
  // available without first being returned and inspected.
  RENTED: ["RETURNED", "ACCIDENT"],
  // Returned early, bought out at the end, or involved in an accident.
  LEASE_TO_OWN: ["RETURNED", "SOLD", "ACCIDENT"],
  MAINTENANCE: ["AVAILABLE", "INACTIVE"],
  // Repaired, written off, or sold for salvage.
  ACCIDENT: ["MAINTENANCE", "INACTIVE", "SOLD"],
  // Inspected and back in the fleet, sent for service, or found damaged on return.
  RETURNED: ["AVAILABLE", "MAINTENANCE", "ACCIDENT"],
  // Sold is final. Undoing a sale is a correction to the record, not a status change.
  SOLD: [],
  INACTIVE: ["AVAILABLE", "SOLD"],
};

/** Statuses in which the car is committed to a customer and cannot be offered to another. */
export const ON_CONTRACT_STATUSES: readonly VehicleStatus[] = ["RESERVED", "RENTED", "LEASE_TO_OWN"];

/**
 * Statuses only a contract may put a car into. A car is Rented or Lease-to-own because a
 * live contract says so (INV-9); set by hand, the fleet would show a car out on a contract
 * that exists nowhere, earning revenue nothing records.
 */
export const CONTRACT_MANAGED_STATUSES: readonly VehicleStatus[] = ["RENTED", "LEASE_TO_OWN"];

/** Mirrors the `OwnershipType` enum in the Prisma schema. */
export type VehicleOwnership = "COMPANY_OWNED" | "B2B_SUPPLIER";

export function isVehicleStatus(value: string): value is VehicleStatus {
  return (VEHICLE_STATUSES as readonly string[]).includes(value);
}

/**
 * What ownership forbids on top of the table.
 *
 * A car leased in from a supplier is not DrivenX's to put on a plain rental or to sell:
 * it goes to a customer only on lease-to-own, and is sold only as the end of that lease
 * — the buyout. Answered by the client on 2026-09-18.
 */
function ownershipAllows(from: VehicleStatus, to: VehicleStatus, ownership: VehicleOwnership): boolean {
  if (ownership !== "B2B_SUPPLIER") return true;
  if (to === "RENTED") return false;
  if (to === "SOLD") return from === "LEASE_TO_OWN";
  return true;
}

/**
 * Ownership is required, not defaulted. A default would let a caller that forgot it skip
 * the supplier rule silently; required, the compiler finds every caller that has to say.
 */
export function allowedTransitions(
  from: VehicleStatus,
  ownership: VehicleOwnership,
): readonly VehicleStatus[] {
  return TRANSITIONS[from].filter((to) => ownershipAllows(from, to, ownership));
}

/** Staying in the same status is not a transition, so it is never "allowed". */
export function canTransition(
  from: VehicleStatus,
  to: VehicleStatus,
  ownership: VehicleOwnership,
): boolean {
  return TRANSITIONS[from].includes(to) && ownershipAllows(from, to, ownership);
}

export function isTerminal(status: VehicleStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export class IllegalVehicleTransitionError extends Error {
  readonly from: VehicleStatus;
  readonly to: VehicleStatus;
  /**
   * True when the move is legal in the table but not for a car leased from a supplier,
   * so the message can say why rather than only that it was refused.
   */
  readonly blockedByOwnership: boolean;

  constructor(from: VehicleStatus, to: VehicleStatus, blockedByOwnership = false) {
    super(
      blockedByOwnership
        ? `A vehicle leased from a supplier cannot move from ${from} to ${to}`
        : `A vehicle cannot move from ${from} to ${to}`,
    );
    this.name = "IllegalVehicleTransitionError";
    this.from = from;
    this.to = to;
    this.blockedByOwnership = blockedByOwnership;
  }
}

export function assertTransition(
  from: VehicleStatus,
  to: VehicleStatus,
  ownership: VehicleOwnership,
): void {
  if (canTransition(from, to, ownership)) return;
  const legalInTable = TRANSITIONS[from].includes(to);
  throw new IllegalVehicleTransitionError(from, to, legalInTable);
}
