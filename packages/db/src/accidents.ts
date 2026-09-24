/**
 * Accidents and insurance claims (P2-09, P2-10, SOW §13).
 *
 * Two events on different clocks. A car is hit, repaired and back on the road on one
 * timeline; the insurer agrees, reduces, refuses and eventually pays on another. This
 * keeps them apart and lets the ledger take from each only what is certain.
 *
 * The repair is a cost on the day it is billed, not on the day of the crash — a car hit
 * in March and repaired in May is a May cost, and dating it to March would move money
 * into a month that has already been reported on. It is held net, like maintenance,
 * because the garage's VAT is reclaimed and is not a cost.
 *
 * The claim brings money in only when money genuinely arrives. An approved claim is not
 * cash: insurers pay less than they approve and later than they say, and recognising an
 * approval would report a recovery that may never land. It posts to
 * `revenue.insurance_claim`, deliberately not to `revenue.insurance` — that one is the
 * premium charged to a customer, which §11 requires to be reportable on its own, and a
 * payout mixed into it would inflate the single figure the SOW asks to see separately.
 */

import {
  assertAccidentTransition,
  assertClaimTransition,
  netAccidentCost,
  vatOn,
  type AccidentResponsibility,
  type AccidentStatus,
  type ClaimStatus,
  type IsoDate,
} from "@drivenx/core";

import { toDbDate } from "./dates";
import { prisma } from "./index";
import { postToLedger } from "./ledger";
import type { Tx } from "./tx";

export type AccidentRuleCode =
  | "vehicleNotFound"
  | "accidentNotFound"
  | "invalidAccident"
  | "alreadyRepaired"
  | "claimExists"
  | "claimNotFound"
  | "invalidClaim"
  | "policyNotFound"
  | "nothingReceived";

export class AccidentRuleError extends Error {
  constructor(readonly code: AccidentRuleCode) {
    super(`Accident refused: ${code}`);
    this.name = "AccidentRuleError";
  }
}

export interface NewAccident {
  vehicleId: string;
  occurredOn: IsoDate;
  location: string;
  description?: string | null;
  responsibility?: AccidentResponsibility;
  policeReportNumber?: string | null;
  notes?: string | null;
}

/** The contract a car was out on for a given day, if any. */
async function contractOn(tx: Tx, vehicleId: string, day: IsoDate) {
  return tx.contract.findFirst({
    where: {
      vehicleId,
      deletedAt: null,
      startDate: { lte: toDbDate(day) },
      endDate: { gte: toDbDate(day) },
      status: { in: ["ACTIVE", "OVERDUE", "COMPLETED", "CANCELLED"] },
    },
    orderBy: { startDate: "desc" },
    select: { id: true, customerId: true },
  });
}

/** Log a crash. Nothing is costed: no bill has arrived. */
export async function recordAccident(input: NewAccident, actorId: string | null) {
  const location = input.location.trim();
  if (!location) throw new AccidentRuleError("invalidAccident");

  return prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.findFirst({
      where: { id: input.vehicleId, deletedAt: null },
      select: { id: true },
    });
    if (!vehicle) throw new AccidentRuleError("vehicleNotFound");

    const contract = await contractOn(tx, vehicle.id, input.occurredOn);

    const accident = await tx.accident.create({
      data: {
        vehicleId: vehicle.id,
        contractId: contract?.id ?? null,
        customerId: contract?.customerId ?? null,
        occurredOn: toDbDate(input.occurredOn),
        location,
        description: input.description?.trim() || null,
        responsibility: input.responsibility ?? "UNKNOWN",
        policeReportNumber: input.policeReportNumber?.trim() || null,
        notes: input.notes?.trim() || null,
        createdById: actorId,
      },
    });

    await tx.accidentStatusChange.create({
      data: { accidentId: accident.id, fromStatus: null, toStatus: "REPORTED", changedById: actorId },
    });

    return accident;
  });
}

export async function transitionAccident(
  accidentId: string,
  move: { to: AccidentStatus; reason?: string | null; actorId: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const accident = await tx.accident.findFirst({
      where: { id: accidentId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!accident) throw new AccidentRuleError("accidentNotFound");

    assertAccidentTransition(accident.status, move.to);

    const updated = await tx.accident.update({ where: { id: accidentId }, data: { status: move.to } });
    await tx.accidentStatusChange.create({
      data: {
        accidentId,
        fromStatus: accident.status,
        toStatus: move.to,
        reason: move.reason?.trim() || null,
        changedById: move.actorId,
      },
    });
    return updated;
  });
}

export interface RepairBill {
  /** The garage's bill, net of VAT. */
  repairNetFils: bigint;
  vatBasisPoints?: number;
  vendor: string;
  /** The day the bill fell, which is the day it becomes a cost. */
  repairedOn: IsoDate;
}

/**
 * Record what putting the car right cost, and post it.
 *
 * Once only: a second bill for the same accident would double the cost, and the ledger's
 * uniqueness on (source, category) would refuse it anyway. A repair that turns out to
 * have been billed wrongly is corrected by a reversing entry, as everything else is.
 */
/* The actor is not a parameter: recording a bill changes no status and adds no history
   row of its own, and the audit extension already stamps the mutation with whoever made
   it. A second, ignored copy of the same fact is one that can disagree. */
export async function recordRepair(accidentId: string, bill: RepairBill) {
  const vendor = bill.vendor.trim();
  if (!vendor || bill.repairNetFils < 0n) throw new AccidentRuleError("invalidClaim");

  const vatBasisPoints = bill.vatBasisPoints ?? 500;
  const repairVatFils = vatOn(bill.repairNetFils, vatBasisPoints);

  return prisma.$transaction(async (tx) => {
    const accident = await tx.accident.findFirst({
      where: { id: accidentId, deletedAt: null },
      select: { id: true, vehicleId: true, contractId: true, customerId: true, repairFils: true },
    });
    if (!accident) throw new AccidentRuleError("accidentNotFound");
    if (accident.repairFils !== null) throw new AccidentRuleError("alreadyRepaired");

    const updated = await tx.accident.update({
      where: { id: accidentId },
      data: {
        repairNetFils: bill.repairNetFils,
        vatBasisPoints,
        repairVatFils,
        repairFils: bill.repairNetFils + repairVatFils,
        repairVendor: vendor,
        repairedOn: toDbDate(bill.repairedOn),
      },
    });

    if (bill.repairNetFils > 0n) {
      await postToLedger(tx, {
        occurredOn: bill.repairedOn,
        direction: "COST",
        category: "cost.repair",
        // Net: the VAT on the garage's bill is reclaimed, so it is not a cost.
        amountFils: bill.repairNetFils,
        vehicleId: accident.vehicleId,
        contractId: accident.contractId,
        customerId: accident.customerId,
        sourceType: "Accident",
        sourceId: accident.id,
        memo: vendor,
      });
    }

    return updated;
  });
}

export interface NewClaim {
  accidentId: string;
  policyId?: string | null;
  claimNumber: string;
  lodgedOn: IsoDate;
  claimedFils: bigint;
  notes?: string | null;
}

/** Lodge a claim. One per accident. */
export async function lodgeClaim(input: NewClaim, actorId: string | null) {
  const claimNumber = input.claimNumber.trim();
  if (!claimNumber || input.claimedFils <= 0n) throw new AccidentRuleError("invalidClaim");

  return prisma.$transaction(async (tx) => {
    const accident = await tx.accident.findFirst({
      where: { id: input.accidentId, deletedAt: null },
      include: { claim: { select: { id: true } } },
    });
    if (!accident) throw new AccidentRuleError("accidentNotFound");
    if (accident.claim) throw new AccidentRuleError("claimExists");

    if (input.policyId) {
      const policy = await tx.insurancePolicy.findFirst({
        where: { id: input.policyId, deletedAt: null },
        select: { id: true },
      });
      if (!policy) throw new AccidentRuleError("policyNotFound");
    }

    const claim = await tx.insuranceClaim.create({
      data: {
        accidentId: accident.id,
        policyId: input.policyId ?? null,
        claimNumber,
        lodgedOn: toDbDate(input.lodgedOn),
        claimedFils: input.claimedFils,
        notes: input.notes?.trim() || null,
        createdById: actorId,
      },
    });

    await tx.claimStatusChange.create({
      data: { claimId: claim.id, fromStatus: null, toStatus: "LODGED", changedById: actorId },
    });

    return claim;
  });
}

export interface ClaimMove {
  to: ClaimStatus;
  /** What the insurer agreed to, when moving to APPROVED. */
  approvedFils?: bigint;
  /** What actually arrived, when moving to SETTLED. Only this reaches the ledger. */
  receivedFils?: bigint;
  settledOn?: IsoDate;
  reason?: string | null;
  actorId: string | null;
}

/**
 * Move a claim along, posting a recovery only when money has genuinely arrived.
 *
 * A claim settled for less than it was approved for is the normal case, not an error:
 * the shortfall is the policy excess and whatever the insurer disallowed, and it stays
 * with DrivenX as a cost — which is exactly what vehicle profitability should show.
 */
export async function transitionClaim(claimId: string, move: ClaimMove) {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.insuranceClaim.findFirst({
      where: { id: claimId, deletedAt: null },
      include: {
        accident: { select: { id: true, vehicleId: true, contractId: true, customerId: true } },
      },
    });
    if (!claim) throw new AccidentRuleError("claimNotFound");

    assertClaimTransition(claim.status, move.to);

    if (move.to === "SETTLED") {
      // Settled means money landed. Without a figure and a date there is nothing to post
      // and nothing to reconcile against the insurer's remittance.
      if (move.receivedFils === undefined || move.receivedFils < 0n || !move.settledOn) {
        throw new AccidentRuleError("nothingReceived");
      }
    }

    const updated = await tx.insuranceClaim.update({
      where: { id: claimId },
      data: {
        status: move.to,
        ...(move.approvedFils !== undefined ? { approvedFils: move.approvedFils } : {}),
        ...(move.to === "SETTLED"
          ? { receivedFils: move.receivedFils, settledOn: toDbDate(move.settledOn as IsoDate) }
          : {}),
      },
    });

    await tx.claimStatusChange.create({
      data: {
        claimId,
        fromStatus: claim.status,
        toStatus: move.to,
        reason: move.reason?.trim() || null,
        changedById: move.actorId,
      },
    });

    if (move.to === "SETTLED" && (move.receivedFils ?? 0n) > 0n) {
      await postToLedger(tx, {
        occurredOn: move.settledOn as IsoDate,
        direction: "REVENUE",
        // Its own category, kept clear of revenue.insurance — that is the premium
        // charged to a customer, which §11 wants reportable on its own.
        category: "revenue.insurance_claim",
        amountFils: move.receivedFils as bigint,
        vehicleId: claim.accident.vehicleId,
        contractId: claim.accident.contractId,
        customerId: claim.accident.customerId,
        sourceType: "InsuranceClaim",
        sourceId: claim.id,
        memo: claim.claimNumber,
      });
    }

    return updated;
  });
}

export async function accidentsForVehicle(vehicleId: string) {
  return prisma.accident.findMany({
    where: { vehicleId, deletedAt: null },
    orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
    include: {
      claim: true,
      contract: { select: { id: true, number: true } },
      customer: { select: { id: true, fullName: true } },
    },
  });
}

export interface AccidentCost {
  accidentId: string;
  repairNetFils: bigint;
  claimReceivedFils: bigint;
  /** What DrivenX is left carrying: the repair less whatever the insurer actually paid. */
  netCostFils: bigint;
}

/** What each accident on a car has cost, once the insurer has done whatever it will do. */
export async function accidentCosts(vehicleId: string): Promise<AccidentCost[]> {
  const accidents = await prisma.accident.findMany({
    where: { vehicleId, deletedAt: null },
    select: { id: true, repairNetFils: true, claim: { select: { receivedFils: true } } },
  });

  return accidents.map((accident) => {
    const repairNetFils = accident.repairNetFils ?? 0n;
    const claimReceivedFils = accident.claim?.receivedFils ?? 0n;
    return {
      accidentId: accident.id,
      repairNetFils,
      claimReceivedFils,
      netCostFils: netAccidentCost(repairNetFils, claimReceivedFils),
    };
  });
}
