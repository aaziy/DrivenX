/**
 * Traffic fines (P2-07, P2-08, SOW §13).
 *
 * A fine arrives addressed to the car, whoever was driving it. Everything here turns on
 * keeping two questions apart: who was driving, and whose money moved.
 *
 * Who was driving is answered by the offence date, not by today. A notice often reaches
 * DrivenX weeks later, by which time the car may be back in the yard or out with someone
 * else, so the contract is looked up as it stood on the day of the offence.
 *
 * Whose money moved decides the ledger. Nothing is posted when a fine is merely recorded
 * or merely blamed on someone: a fine the customer settles directly with the authority
 * never touches these books at all. `cost.fine` is posted on the day DrivenX pays the
 * authority, and `revenue.fine_recovery` only when the customer is actually invoiced —
 * because a recovery booked on the strength of a liability is profit DrivenX has not
 * collected and, if the customer disappears, never will.
 *
 * The recharge is an ordinary instalment, raised and numbered through the same machinery
 * as every other invoice, so it appears on the customer's statement and settles through
 * the payment paths that already exist rather than a second, parallel set.
 */

import {
  assertFineTransition,
  defaultFinePayer,
  type FinePayer,
  type FineStatus,
  type IsoDate,
} from "@drivenx/core";

import { issueDueForContract } from "./contracts";
import { toDbDate } from "./dates";
import { prisma } from "./index";
import { postToLedger } from "./ledger";
import type { Tx } from "./tx";

export type FineRuleCode =
  | "vehicleNotFound"
  | "fineNotFound"
  | "invalidFine"
  | "duplicateFine"
  | "noCustomerToRecharge"
  | "alreadyRecovered"
  | "recoveryNotFound";

export class FineRuleError extends Error {
  constructor(readonly code: FineRuleCode) {
    super(`Fine refused: ${code}`);
    this.name = "FineRuleError";
  }
}

export interface NewFine {
  vehicleId: string;
  fineNumber: string;
  authority: string;
  /** The day of the offence, which decides who was driving. */
  occurredOn: IsoDate;
  /** The day the notice reached DrivenX. */
  issuedOn?: IsoDate | null;
  /** The whole penalty. No VAT: a fine is not a supply. */
  amountFils: bigint;
  /** Left out, it follows from whether the car was out on a contract that day. */
  payer?: FinePayer;
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
    select: { id: true, customerId: true, vehicleId: true, supplierId: true, number: true, vatBasisPoints: true },
  });
}

async function recordStatusChange(
  tx: Tx,
  fineId: string,
  from: FineStatus | null,
  to: FineStatus,
  actorId: string | null,
  reason?: string | null,
) {
  await tx.fineStatusChange.create({
    data: { fineId, fromStatus: from, toStatus: to, reason: reason?.trim() || null, changedById: actorId },
  });
}

/** Record a notice. Nothing is posted: no money has moved yet. */
export async function recordFine(input: NewFine, actorId: string | null) {
  const fineNumber = input.fineNumber.trim();
  const authority = input.authority.trim();
  if (!fineNumber || !authority || input.amountFils <= 0n) throw new FineRuleError("invalidFine");

  return prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.findFirst({
      where: { id: input.vehicleId, deletedAt: null },
      select: { id: true },
    });
    if (!vehicle) throw new FineRuleError("vehicleNotFound");

    const duplicate = await tx.fine.findFirst({
      where: { authority, fineNumber, deletedAt: null },
      select: { id: true },
    });
    // The same notice entered twice is the same cost counted twice.
    if (duplicate) throw new FineRuleError("duplicateFine");

    const contract = await contractOn(tx, vehicle.id, input.occurredOn);

    const fine = await tx.fine.create({
      data: {
        vehicleId: vehicle.id,
        contractId: contract?.id ?? null,
        customerId: contract?.customerId ?? null,
        fineNumber,
        authority,
        occurredOn: toDbDate(input.occurredOn),
        issuedOn: input.issuedOn ? toDbDate(input.issuedOn) : null,
        amountFils: input.amountFils,
        payer: input.payer ?? defaultFinePayer(contract !== null),
        createdById: actorId,
      },
    });

    await recordStatusChange(tx, fine.id, null, "OPEN", actorId);
    return fine;
  });
}

/** Who the fine falls to. Staff can always override what the offence date implied. */
export async function setFinePayer(fineId: string, payer: FinePayer) {
  const fine = await prisma.fine.findFirst({ where: { id: fineId, deletedAt: null }, select: { id: true } });
  if (!fine) throw new FineRuleError("fineNotFound");
  return prisma.fine.update({ where: { id: fineId }, data: { payer } });
}

export interface FineTransition {
  to: FineStatus;
  /** The day DrivenX paid the authority. Required when moving to PAID. */
  paidOn?: IsoDate;
  reason?: string | null;
  actorId: string | null;
}

/**
 * Move a fine along, posting the cost when — and only when — DrivenX pays the authority.
 *
 * `PAID` is the one transition that costs anything. Recovery and waiving are decisions
 * about money that has already left, so neither reverses the cost: a fine DrivenX chose
 * to absorb is a cost it chose to bear, and that is exactly what vehicle profitability
 * should show.
 */
export async function transitionFine(fineId: string, move: FineTransition) {
  return prisma.$transaction(async (tx) => {
    const fine = await tx.fine.findFirst({
      where: { id: fineId, deletedAt: null },
      include: { contract: { select: { customerId: true } } },
    });
    if (!fine) throw new FineRuleError("fineNotFound");

    assertFineTransition(fine.status, move.to);

    // Recovery has its own path: it raises an invoice, which this cannot do blindly.
    if (move.to === "RECOVERED") throw new FineRuleError("invalidFine");

    const paidOn = move.to === "PAID" ? (move.paidOn ?? null) : null;
    if (move.to === "PAID" && !paidOn) throw new FineRuleError("invalidFine");

    const updated = await tx.fine.update({
      where: { id: fineId },
      data: {
        status: move.to,
        // Paying sets the day; leaving PAID for RECOVERED or WAIVED keeps it, because
        // the money left on that day whatever happens afterwards.
        ...(paidOn ? { paidOn: toDbDate(paidOn) } : {}),
      },
    });

    await recordStatusChange(tx, fineId, fine.status, move.to, move.actorId, move.reason);

    if (move.to === "PAID" && paidOn) {
      await postToLedger(tx, {
        occurredOn: paidOn,
        direction: "COST",
        category: "cost.fine",
        // The whole penalty: there is no VAT on a fine to hold back.
        amountFils: fine.amountFils,
        vehicleId: fine.vehicleId,
        contractId: fine.contractId,
        customerId: fine.customerId,
        sourceType: "Fine",
        sourceId: fine.id,
        memo: `${fine.authority} ${fine.fineNumber}`,
      });
    }

    return updated;
  });
}

/**
 * Recharge a fine DrivenX paid to the customer who incurred it (P2-08).
 *
 * Raises one ordinary instalment, due the day it is raised, through the same path as
 * every other invoice — so it is numbered, recognised, shown on the statement and paid
 * off by the existing payment machinery.
 *
 * No VAT is added. A fine paid on the customer's behalf is a disbursement rather than a
 * supply by DrivenX, so recharging it at cost adds no output tax. **This is the one part
 * of the design that needs the client's accountant to confirm** — if they treat the
 * recharge as a taxable supply instead, this becomes the contract's ordinary VAT rate
 * and nothing else about the flow changes.
 *
 * Like settling a contract, this issues anything else already due on the same contract,
 * because it goes through the one path that numbers invoices. That is the nightly job's
 * work done a few hours early rather than a second way of recognising revenue.
 */
export async function recoverFine(fineId: string, options: { actorId: string | null; today: IsoDate }) {
  return prisma.$transaction(async (tx) => {
    const fine = await tx.fine.findFirst({
      where: { id: fineId, deletedAt: null },
      include: {
        contract: {
          select: { id: true, customerId: true, vehicleId: true, supplierId: true, number: true },
        },
      },
    });
    if (!fine) throw new FineRuleError("fineNotFound");

    assertFineTransition(fine.status, "RECOVERED");
    if (fine.recoveryInstallmentId) throw new FineRuleError("alreadyRecovered");
    // Someone has to be recharged, and they have to still be on a contract to invoice.
    if (!fine.contract || !fine.customerId) throw new FineRuleError("noCustomerToRecharge");

    const label = `Traffic fine ${fine.authority} ${fine.fineNumber}`;
    const charge = await tx.contractCharge.create({
      data: {
        contractId: fine.contract.id,
        key: `fine:${fine.id}`,
        chargeType: "FINE_RECOVERY",
        label,
        recurrence: "ONCE",
        amountFils: fine.amountFils,
        startsOn: toDbDate(options.today),
        occurrences: 1,
        // A disbursement, not a supply: see the note above.
        vatBasisPoints: 0,
      },
    });

    const installment = await tx.installment.create({
      data: {
        contractId: fine.contract.id,
        chargeId: charge.id,
        sequence: 1,
        periodStart: toDbDate(options.today),
        periodEnd: toDbDate(options.today),
        dueDate: toDbDate(options.today),
        netFils: fine.amountFils,
        vatBasisPoints: 0,
        vatFils: 0n,
        grossFils: fine.amountFils,
      },
    });

    // Due today, so it is numbered and recognised now, by the same path as the rest.
    await issueDueForContract(tx, fine.contract, options.today);

    const updated = await tx.fine.update({
      where: { id: fine.id },
      data: {
        status: "RECOVERED",
        recoveryInstallmentId: installment.id,
        recoveredOn: toDbDate(options.today),
      },
    });

    await recordStatusChange(tx, fine.id, fine.status, "RECOVERED", options.actorId, label);
    return updated;
  });
}

export async function finesForVehicle(vehicleId: string) {
  return prisma.fine.findMany({
    where: { vehicleId, deletedAt: null },
    orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
    include: {
      contract: { select: { id: true, number: true } },
      customer: { select: { id: true, fullName: true } },
      recoveryInstallment: { select: { invoiceNumber: true, grossFils: true, paidFils: true } },
    },
  });
}

export async function finesForContract(contractId: string) {
  return prisma.fine.findMany({
    where: { contractId, deletedAt: null },
    orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
    include: { recoveryInstallment: { select: { invoiceNumber: true } } },
  });
}

/** Fines still to be resolved, for the operations screen and the dashboard's alerts. */
export async function outstandingFines() {
  return prisma.fine.findMany({
    where: { deletedAt: null, status: { in: ["OPEN", "DISPUTED", "PAID"] } },
    orderBy: [{ occurredOn: "asc" }],
    include: {
      vehicle: { select: { id: true, code: true, make: true, model: true, plateCode: true, plateNumber: true } },
      customer: { select: { id: true, fullName: true } },
    },
  });
}
