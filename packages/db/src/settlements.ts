/**
 * Ending a contract, and the reckoning that goes with it (client 2026-09-20; P2-12).
 *
 * Early termination is settled case by case: a settlement opens with the arrears already
 * visible, and staff add what is owed on top — excess mileage, damage, a fee — or take
 * something off. There is no penalty formula, because the client does not work to one.
 *
 * Arrears are never lines on the settlement. An instalment already invoiced is already
 * revenue and already owed; charging it again here would count it twice and would break
 * INV-4. What the settlement adds is new, and becomes one final invoice — an ordinary
 * instalment, due the day it is settled — so it is numbered, recognised and paid through
 * the machinery that already exists rather than a second, parallel one.
 *
 * Ending the contract then releases the car and cancels the months that never fell due.
 * Those months carry no ledger entries, because revenue is recognised at issue, so
 * cancelling them takes nothing back.
 */

import {
  assertContractTransition,
  assertTransition,
  vatOn,
  type IsoDate,
  type VehicleStatus,
} from "@drivenx/core";

import type {
  ContractStatus,
  SettlementChargeType,
  SettlementLineKind,
  SettlementReason,
} from "../generated/client";
import { issueDueForContract } from "./contracts";
import { toDbDate } from "./dates";
import { prisma } from "./index";
import type { Tx } from "./tx";

export type SettlementRuleCode =
  | "contractNotFound"
  | "contractNotLive"
  | "settlementExists"
  | "settlementNotFound"
  | "settlementClosed"
  | "invalidLine"
  | "lineNotFound"
  | "creditsExceedCharges"
  | "settlementNotSettled"
  | "mileageBelowStart";

export class SettlementRuleError extends Error {
  constructor(readonly code: SettlementRuleCode) {
    super(`Settlement refused: ${code}`);
    this.name = "SettlementRuleError";
  }
}

const LIVE: ContractStatus[] = ["ACTIVE", "OVERDUE"];

/** Serialises everything touching one contract's money, as the contract service does. */
async function lockContract(tx: Tx, contractId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId} FOR UPDATE`;
}

/**
 * Open the reckoning on a live contract.
 *
 * One per contract: reopening a settled one would invite a second final invoice.
 */
export async function openSettlement(
  contractId: string,
  options: { reason: SettlementReason; returnedMileageKm?: number | null; actorId: string | null },
) {
  return prisma.$transaction(async (tx) => {
    await lockContract(tx, contractId);
    const contract = await tx.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      include: { settlement: { select: { id: true } }, vehicle: { select: { currentMileageKm: true } } },
    });
    if (!contract) throw new SettlementRuleError("contractNotFound");
    if (!LIVE.includes(contract.status)) throw new SettlementRuleError("contractNotLive");
    if (contract.settlement) throw new SettlementRuleError("settlementExists");

    const mileage = options.returnedMileageKm ?? null;
    if (mileage !== null && mileage < contract.vehicle.currentMileageKm) {
      // A car cannot come back having travelled less than it had already travelled.
      throw new SettlementRuleError("mileageBelowStart");
    }

    return tx.settlement.create({
      data: {
        contractId,
        reason: options.reason,
        returnedMileageKm: mileage,
        openedById: options.actorId,
      },
    });
  });
}

export interface NewSettlementLine {
  kind: SettlementLineKind;
  chargeType?: SettlementChargeType;
  label: string;
  /** Net; VAT is added at the rate given, or the standard one. */
  netFils: bigint;
  vatBasisPoints?: number;
}

export async function addSettlementLine(settlementId: string, line: NewSettlementLine, actorId: string | null) {
  const label = line.label.trim();
  if (!label || line.netFils <= 0n) throw new SettlementRuleError("invalidLine");

  const settlement = await prisma.settlement.findUnique({ where: { id: settlementId }, select: { status: true } });
  if (!settlement) throw new SettlementRuleError("settlementNotFound");
  if (settlement.status !== "OPEN") throw new SettlementRuleError("settlementClosed");

  const vatBasisPoints = line.vatBasisPoints ?? 500;
  const vatFils = vatOn(line.netFils, vatBasisPoints);
  return prisma.settlementLine.create({
    data: {
      settlementId,
      kind: line.kind,
      chargeType: line.chargeType ?? "OTHER",
      label,
      netFils: line.netFils,
      vatBasisPoints,
      vatFils,
      grossFils: line.netFils + vatFils,
      createdById: actorId,
    },
  });
}

export async function removeSettlementLine(lineId: string) {
  const line = await prisma.settlementLine.findUnique({
    where: { id: lineId },
    select: { settlement: { select: { status: true } } },
  });
  if (!line) throw new SettlementRuleError("lineNotFound");
  if (line.settlement.status !== "OPEN") throw new SettlementRuleError("settlementClosed");
  await prisma.settlementLine.delete({ where: { id: lineId } });
}

export interface SettlementTotals {
  /** Invoiced, unpaid and not waived: what is already owed, gross. */
  arrearsFils: bigint;
  chargesNetFils: bigint;
  chargesGrossFils: bigint;
  creditsNetFils: bigint;
  creditsGrossFils: bigint;
  /** What the final invoice will be: charges less credits, net. */
  finalNetFils: bigint;
  finalGrossFils: bigint;
  /** Arrears plus the final invoice: everything the customer owes to walk away. */
  totalDueFils: bigint;
}

/** What is owed on a contract right now, with a settlement's lines if it has one. */
export async function settlementTotals(contractId: string): Promise<SettlementTotals> {
  const [installments, lines] = await Promise.all([
    prisma.installment.findMany({
      where: { contractId, invoiceNumber: { not: null }, waivedAt: null },
      select: { grossFils: true, paidFils: true },
    }),
    prisma.settlementLine.findMany({ where: { settlement: { contractId } } }),
  ]);

  const arrearsFils = installments.reduce((sum, item) => sum + (item.grossFils - item.paidFils), 0n);
  const sum = (kind: SettlementLineKind, field: "netFils" | "grossFils") =>
    lines.filter((line) => line.kind === kind).reduce((total, line) => total + line[field], 0n);

  const chargesNetFils = sum("CHARGE", "netFils");
  const creditsNetFils = sum("CREDIT", "netFils");
  const chargesGrossFils = sum("CHARGE", "grossFils");
  const creditsGrossFils = sum("CREDIT", "grossFils");
  const finalNetFils = chargesNetFils - creditsNetFils;
  const finalGrossFils = chargesGrossFils - creditsGrossFils;

  return {
    arrearsFils,
    chargesNetFils,
    chargesGrossFils,
    creditsNetFils,
    creditsGrossFils,
    finalNetFils,
    finalGrossFils,
    totalDueFils: arrearsFils + (finalGrossFils > 0n ? finalGrossFils : 0n),
  };
}

/**
 * Settle: turn the lines into one final invoice, numbered and recognised today.
 *
 * Credits reduce that invoice rather than becoming one of their own — a negative invoice
 * is not a thing this system issues. Credits worth more than the charges are refused, so
 * nobody quietly creates a debt to the customer here; forgiving arrears is waiving an
 * instalment, which is its own deliberate act with its own reason.
 */
export async function settleSettlement(settlementId: string, options: { actorId: string | null; today: IsoDate }) {
  return prisma.$transaction(
    async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId },
        include: { lines: true, contract: { select: { id: true, number: true, customerId: true, vehicleId: true, supplierId: true, vatBasisPoints: true } } },
      });
      if (!settlement) throw new SettlementRuleError("settlementNotFound");
      if (settlement.status !== "OPEN") throw new SettlementRuleError("settlementClosed");
      await lockContract(tx, settlement.contractId);

      const net = settlement.lines.reduce(
        (sum, line) => sum + (line.kind === "CHARGE" ? line.netFils : -line.netFils),
        0n,
      );
      if (net < 0n) throw new SettlementRuleError("creditsExceedCharges");

      let installmentId: string | null = null;
      if (net > 0n) {
        const vatBasisPoints = settlement.contract.vatBasisPoints;
        const vatFils = vatOn(net, vatBasisPoints);
        // A charge of its own, so the schedule shows where the final invoice came from.
        const charge = await tx.contractCharge.create({
          data: {
            contractId: settlement.contractId,
            key: "settlement",
            chargeType: "OTHER",
            label: "Final settlement",
            recurrence: "ONCE",
            amountFils: net,
            startsOn: toDbDate(options.today),
            occurrences: 1,
            vatBasisPoints,
          },
        });
        const installment = await tx.installment.create({
          data: {
            contractId: settlement.contractId,
            chargeId: charge.id,
            sequence: 1,
            periodStart: toDbDate(options.today),
            periodEnd: toDbDate(options.today),
            dueDate: toDbDate(options.today),
            netFils: net,
            vatBasisPoints,
            vatFils,
            grossFils: net + vatFils,
          },
        });
        installmentId = installment.id;

        // Issued at once: it is due today, so it is numbered and recognised now, by the
        // same path as every other instalment.
        await issueDueForContract(tx, settlement.contract, options.today);
      }

      return tx.settlement.update({
        where: { id: settlement.id },
        data: {
          status: "SETTLED",
          settledById: options.actorId,
          settledOn: toDbDate(options.today),
          installmentId,
        },
      });
    },
    { timeout: 30_000 },
  );
}

export interface TerminationOptions {
  /** Ended early, or ran its course. */
  outcome: "EARLY_TERMINATION" | "END_OF_TERM";
  /** Where the car goes: back to the yard, or to the customer on a lease-to-own buyout. */
  vehicleTo: Extract<VehicleStatus, "RETURNED" | "SOLD">;
  actorId: string | null;
  today: IsoDate;
}

/**
 * End a live contract.
 *
 * Refused while a settlement is still open: ending first and reckoning later is how the
 * reckoning never happens. Months that never fell due are cancelled rather than deleted,
 * so the schedule still shows what would have been.
 */
export async function terminateContract(contractId: string, options: TerminationOptions) {
  return prisma.$transaction(async (tx) => {
    await lockContract(tx, contractId);
    const contract = await tx.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      include: {
        settlement: { select: { status: true } },
        vehicle: { select: { id: true, status: true, ownershipType: true } },
      },
    });
    if (!contract) throw new SettlementRuleError("contractNotFound");
    if (!LIVE.includes(contract.status)) throw new SettlementRuleError("contractNotLive");
    if (contract.settlement && contract.settlement.status === "OPEN") {
      throw new SettlementRuleError("settlementNotSettled");
    }

    const to: ContractStatus = options.outcome === "END_OF_TERM" ? "COMPLETED" : "CANCELLED";
    assertContractTransition(contract.status, to);
    assertTransition(contract.vehicle.status, options.vehicleTo, contract.vehicle.ownershipType);

    // Never invoiced, so never revenue: cancelling them takes nothing back.
    const { count: cancelled } = await tx.installment.updateMany({
      where: { contractId, invoiceNumber: null, waivedAt: null },
      data: { status: "CANCELLED" },
    });

    // Supplier invoices for months that will not happen are dropped the same way; the
    // ones already raised stay, because their cost is already in the books.
    const { count: droppedPayables } = await tx.supplierInvoice.deleteMany({
      where: { contractId, raisedOn: null },
    });

    const movedCar = await tx.vehicle.updateMany({
      where: { id: contract.vehicle.id, status: contract.vehicle.status },
      data: { status: options.vehicleTo },
    });
    if (movedCar.count === 0) throw new SettlementRuleError("contractNotLive");
    await tx.vehicleStatusChange.create({
      data: {
        vehicleId: contract.vehicle.id,
        fromStatus: contract.vehicle.status,
        toStatus: options.vehicleTo,
        reason: contract.number,
        changedById: options.actorId,
      },
    });

    await tx.contract.update({ where: { id: contractId }, data: { status: to } });
    await tx.contractStatusChange.create({
      data: { contractId, fromStatus: contract.status, toStatus: to, changedById: options.actorId },
    });

    return { status: to, cancelledInstallments: cancelled, droppedPayables };
  });
}
