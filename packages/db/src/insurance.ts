/**
 * Insurance policies (P1D-10 – P1D-12, SOW §11).
 *
 * What DrivenX pays to insure a car, against what it charges the customer for insurance
 * on the contract. The charge is already a contract charge of its own, so insurance
 * revenue is reported apart from rental (P1E-06); this is the other side of it, and
 * without it insurance reads as pure profit.
 *
 * The premium is the insurer's invoice (client, 2026-09-20), held net with its VAT
 * beside it, because that VAT is recoverable and is not a cost. The cost is posted on the
 * day cover starts — the day it is invoiced — which is also when the annual charge to the
 * customer falls due, so the two meet in the same month.
 *
 * Cancelling mid-term does not rewrite that cost: the ledger is append-only (INV-7), so a
 * refund from the insurer posts a reversing entry on the day it is agreed.
 */

import { compareIsoDates, netFromGross, vatOn, type IsoDate } from "@drivenx/core";

import type { InsuranceCoverage } from "../generated/client";
import { fromDbDate, toDbDate } from "./dates";
import { prisma } from "./index";
import { postToLedger } from "./ledger";

export type InsuranceRuleCode =
  | "vehicleNotFound"
  | "policyNotFound"
  | "invalidPolicy"
  | "datesOutOfOrder"
  | "duplicatePolicyNumber"
  | "alreadyCancelled"
  | "cancelNeedsReason"
  | "refundAbovePremium";

export class InsuranceRuleError extends Error {
  constructor(readonly code: InsuranceRuleCode) {
    super(`Insurance refused: ${code}`);
    this.name = "InsuranceRuleError";
  }
}

export interface NewPolicy {
  vehicleId: string;
  provider: string;
  policyNumber: string;
  coverage: InsuranceCoverage;
  startDate: IsoDate;
  expiryDate: IsoDate;
  /** The insurer's invoice, net of VAT. */
  premiumNetFils: bigint;
  vatBasisPoints?: number;
  notes?: string | null;
}

/**
 * Record a policy and cost its premium.
 *
 * Idempotent through the ledger's uniqueness on (source, category): recording the same
 * policy twice cannot double the cost, and a policy whose posting failed can be retried.
 */
export async function createPolicy(input: NewPolicy, actorId: string | null) {
  const provider = input.provider.trim();
  const policyNumber = input.policyNumber.trim();
  if (!provider || !policyNumber || input.premiumNetFils <= 0n) throw new InsuranceRuleError("invalidPolicy");
  if (compareIsoDates(input.startDate, input.expiryDate) >= 0) throw new InsuranceRuleError("datesOutOfOrder");

  const vehicle = await prisma.vehicle.findFirst({
    where: { id: input.vehicleId, deletedAt: null },
    select: { id: true, supplierId: true },
  });
  if (!vehicle) throw new InsuranceRuleError("vehicleNotFound");

  const vatBasisPoints = input.vatBasisPoints ?? 500;
  const premiumVatFils = vatOn(input.premiumNetFils, vatBasisPoints);

  try {
    return await prisma.$transaction(async (tx) => {
      const policy = await tx.insurancePolicy.create({
        data: {
          vehicleId: vehicle.id,
          provider,
          policyNumber,
          coverage: input.coverage,
          startDate: toDbDate(input.startDate),
          expiryDate: toDbDate(input.expiryDate),
          premiumNetFils: input.premiumNetFils,
          vatBasisPoints,
          premiumVatFils,
          premiumFils: input.premiumNetFils + premiumVatFils,
          notes: input.notes?.trim() || null,
          createdById: actorId,
        },
      });

      await postToLedger(tx, {
        occurredOn: input.startDate,
        direction: "COST",
        category: "cost.insurance",
        // Net: the VAT on the premium is reclaimed, so it is not a cost.
        amountFils: policy.premiumNetFils,
        vehicleId: vehicle.id,
        supplierId: vehicle.supplierId,
        sourceType: "InsurancePolicy",
        sourceId: policy.id,
        memo: `${provider} ${policyNumber}`,
      });

      return policy;
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002") {
      throw new InsuranceRuleError("duplicatePolicyNumber");
    }
    throw error;
  }
}

/**
 * Cancel a policy, and take back what the insurer refunds.
 *
 * The refund is a reversing entry dated the day it is agreed, not an edit of the original
 * cost: the month that carried the cover keeps its cost, and the month of the refund gets
 * the credit.
 */
export async function cancelPolicy(
  policyId: string,
  options: { reason: string; refundFils?: bigint | null; actorId: string | null; today: IsoDate },
) {
  const reason = options.reason.trim();
  if (!reason) throw new InsuranceRuleError("cancelNeedsReason");

  return prisma.$transaction(async (tx) => {
    const policy = await tx.insurancePolicy.findFirst({ where: { id: policyId, deletedAt: null } });
    if (!policy) throw new InsuranceRuleError("policyNotFound");
    if (policy.cancelledAt) throw new InsuranceRuleError("alreadyCancelled");

    const refundFils = options.refundFils ?? 0n;
    if (refundFils < 0n || refundFils > policy.premiumFils) throw new InsuranceRuleError("refundAbovePremium");

    const cancelled = await tx.insurancePolicy.update({
      where: { id: policy.id },
      data: { cancelledAt: new Date(), cancelReason: reason, refundFils },
    });

    if (refundFils > 0n) {
      const original = await tx.ledgerEntry.findFirst({
        where: { sourceType: "InsurancePolicy", sourceId: policy.id, category: "cost.insurance" },
        select: { id: true },
      });
      // The refund's net share: the VAT within it goes back to the FTA, not to profit.
      const refundNet = netFromGross(refundFils, policy.vatBasisPoints);
      await postToLedger(tx, {
        occurredOn: options.today,
        direction: "COST",
        category: "cost.insurance",
        amountFils: -refundNet,
        vehicleId: policy.vehicleId,
        sourceType: "InsurancePolicyRefund",
        sourceId: policy.id,
        reversesId: original?.id ?? null,
        memo: reason,
      });
    }

    return cancelled;
  });
}

export interface PolicyState {
  id: string;
  status: "ACTIVE" | "EXPIRED" | "CANCELLED";
  daysToExpiry: number;
}

/** A policy's state on a given day: cancelled beats expired, expired beats active. */
export function policyState(
  policy: { id: string; expiryDate: Date; startDate: Date; cancelledAt: Date | null },
  today: IsoDate,
): PolicyState {
  const expiry = fromDbDate(policy.expiryDate);
  const daysToExpiry = Math.round(
    (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  const status = policy.cancelledAt ? "CANCELLED" : daysToExpiry < 0 ? "EXPIRED" : "ACTIVE";
  return { id: policy.id, status, daysToExpiry };
}

/** The cover in force on a car today, if any. */
export async function currentPolicy(vehicleId: string, today: IsoDate) {
  return prisma.insurancePolicy.findFirst({
    where: {
      vehicleId,
      deletedAt: null,
      cancelledAt: null,
      startDate: { lte: toDbDate(today) },
      expiryDate: { gte: toDbDate(today) },
    },
    orderBy: { expiryDate: "desc" },
  });
}

/** Policies running out within `days`, soonest first — the renewal list (P1D-12). */
export async function policiesDueForRenewal(today: IsoDate, days = 30) {
  return prisma.insurancePolicy.findMany({
    where: {
      deletedAt: null,
      cancelledAt: null,
      expiryDate: {
        lte: toDbDate(
          new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10) as IsoDate,
        ),
      },
    },
    orderBy: { expiryDate: "asc" },
    include: {
      vehicle: { select: { id: true, code: true, make: true, model: true, plateCode: true, plateNumber: true } },
    },
  });
}
