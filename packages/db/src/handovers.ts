/**
 * Handover and return (P2-01 – P2-03, SOW §12).
 *
 * A handover form is a piece of evidence, and it becomes one at the moment it is signed —
 * not before. So a record is worked on as a draft at the counter, where readings can be
 * corrected and marks added and removed, and signing freezes it: the readings stop being
 * editable, and only then does the odometer become the fleet's mileage.
 *
 * That ordering is deliberate. Posting a draft's odometer to the vehicle straight away
 * would let an abandoned draft raise the car's mileage permanently — and mileage never
 * comes back down, so the next real reading would be refused and the excess-mileage
 * charge at the end of the contract would be computed from a number nobody stood beside
 * the car and read.
 *
 * What this does not do is move the vehicle's status. A car going out and coming back is
 * the contract's business (`activateContract`, `endContract`), and two things writing the
 * same status is how a vehicle ends up Rented with no contract against it.
 */

import {
  excessMileageCharge,
  isBodyPanel,
  isValidFuelEighths,
  panelAt,
  validateMileageReading,
  type DamageSeverity,
  type ExcessMileageResult,
  type VehiclePanel,
} from "@drivenx/core";

import type { ContractStatus, HandoverType, Prisma } from "../generated/client";
import { prisma } from "./index";
import type { Tx } from "./tx";

export type HandoverRuleCode =
  | "contractNotFound"
  | "contractNotOpen"
  | "handoverExists"
  | "handoverNotFound"
  | "handoverSigned"
  | "handoverNotSigned"
  | "noHandoverYet"
  | "returnBeforeHandover"
  | "fuelOutOfRange"
  | "odometerImplausible"
  | "odometerBackwards"
  | "invalidDamagePoint"
  | "damagePointNotFound"
  | "signatureIncomplete";

export class HandoverRuleError extends Error {
  constructor(readonly code: HandoverRuleCode) {
    super(`Handover refused: ${code}`);
    this.name = "HandoverRuleError";
  }
}

/**
 * A car goes out on a live contract. It can come back on one that has already been closed
 * too, because the paperwork does not always keep up with the car: staff who settled on
 * Friday and typed the form on Monday should not be told the return never happened.
 */
const OPEN_FOR_HANDOVER: ContractStatus[] = ["ACTIVE", "OVERDUE"];
const OPEN_FOR_RETURN: ContractStatus[] = ["ACTIVE", "OVERDUE", "COMPLETED"];

export interface NewDamagePoint {
  panel?: VehiclePanel;
  severity?: DamageSeverity;
  /** A fraction of the diagram box. Both or neither; see core/fleet/damage.ts. */
  positionX?: number | null;
  positionY?: number | null;
  note?: string | null;
}

export interface NewHandover {
  contractId: string;
  type: HandoverType;
  occurredAt: Date;
  odometerKm: number;
  fuelEighths: number;
  conditionNotes?: string | null;
  damagePoints?: NewDamagePoint[];
}

/**
 * Resolve a mark to a panel.
 *
 * A mark on the diagram takes the panel it fell in, whatever was submitted alongside it —
 * the picture is the record, and a form field that disagreed with where the person
 * clicked would quietly win. A mark with no position must name one of the panels the
 * diagram cannot show.
 */
function resolveDamagePoint(point: NewDamagePoint) {
  const hasPosition = point.positionX != null && point.positionY != null;

  if (hasPosition) {
    const panel = panelAt(point.positionX as number, point.positionY as number);
    if (!panel) throw new HandoverRuleError("invalidDamagePoint");
    return {
      panel,
      severity: point.severity ?? ("MINOR" as DamageSeverity),
      positionX: point.positionX as number,
      positionY: point.positionY as number,
      note: point.note?.trim() || null,
    };
  }

  // No position: only the off-diagram panels are meaningful, and a body panel without a
  // position would draw nowhere on the report that has to show it.
  if (!point.panel || isBodyPanel(point.panel)) throw new HandoverRuleError("invalidDamagePoint");
  return {
    panel: point.panel,
    severity: point.severity ?? ("MINOR" as DamageSeverity),
    positionX: null,
    positionY: null,
    note: point.note?.trim() || null,
  };
}

/** Serialises everything touching one contract's paperwork, as the money paths do. */
async function lockContract(tx: Tx, contractId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId} FOR UPDATE`;
}

/**
 * Start the form, with whatever marks were made while walking round the car.
 *
 * The odometer is checked for plausibility here and against the fleet at signing: a draft
 * is allowed to be wrong, because it is being filled in beside the car and the point of a
 * draft is that it can be fixed.
 */
export async function recordHandover(input: NewHandover, actorId: string | null) {
  if (!isValidFuelEighths(input.fuelEighths)) throw new HandoverRuleError("fuelOutOfRange");

  const plausible = validateMileageReading(0, input.odometerKm);
  if (!plausible.valid) throw new HandoverRuleError("odometerImplausible");

  const points = (input.damagePoints ?? []).map(resolveDamagePoint);

  return prisma.$transaction(async (tx) => {
    await lockContract(tx, input.contractId);

    const contract = await tx.contract.findFirst({
      where: { id: input.contractId, deletedAt: null },
      select: { id: true, vehicleId: true, status: true },
    });
    if (!contract) throw new HandoverRuleError("contractNotFound");

    const open = input.type === "HANDOVER" ? OPEN_FOR_HANDOVER : OPEN_FOR_RETURN;
    if (!open.includes(contract.status)) throw new HandoverRuleError("contractNotOpen");

    const existing = await tx.handover.findMany({
      where: { contractId: contract.id, deletedAt: null },
      select: { type: true, odometerKm: true },
    });

    if (existing.some((row) => row.type === input.type))
      throw new HandoverRuleError("handoverExists");

    if (input.type === "RETURN") {
      const handover = existing.find((row) => row.type === "HANDOVER");
      // Without the form from the day it went out there is nothing to measure the return
      // against, and the excess-mileage charge has no starting figure.
      if (!handover) throw new HandoverRuleError("noHandoverYet");
      if (input.odometerKm < handover.odometerKm)
        throw new HandoverRuleError("returnBeforeHandover");
    }

    return tx.handover.create({
      data: {
        contractId: contract.id,
        vehicleId: contract.vehicleId,
        type: input.type,
        occurredAt: input.occurredAt,
        odometerKm: input.odometerKm,
        fuelEighths: input.fuelEighths,
        conditionNotes: input.conditionNotes?.trim() || null,
        recordedById: actorId,
        damagePoints: {
          create: points.map((point) => ({ ...point, createdById: actorId })),
        },
      },
      include: { damagePoints: true },
    });
  });
}

async function openDraft(tx: Tx, handoverId: string) {
  const handover = await tx.handover.findFirst({
    where: { id: handoverId, deletedAt: null },
    select: { id: true, status: true, contractId: true },
  });
  if (!handover) throw new HandoverRuleError("handoverNotFound");
  if (handover.status === "SIGNED") throw new HandoverRuleError("handoverSigned");
  return handover;
}

/** Fuel and condition, while the form is still a draft. The odometer is not editable:
 *  it was read off the car, and a reading corrected from memory is not a reading. */
export async function updateHandover(
  handoverId: string,
  patch: { fuelEighths?: number; conditionNotes?: string | null; occurredAt?: Date },
) {
  if (patch.fuelEighths !== undefined && !isValidFuelEighths(patch.fuelEighths)) {
    throw new HandoverRuleError("fuelOutOfRange");
  }

  return prisma.$transaction(async (tx) => {
    await openDraft(tx, handoverId);
    return tx.handover.update({
      where: { id: handoverId },
      data: {
        ...(patch.fuelEighths !== undefined ? { fuelEighths: patch.fuelEighths } : {}),
        ...(patch.occurredAt !== undefined ? { occurredAt: patch.occurredAt } : {}),
        ...(patch.conditionNotes !== undefined
          ? { conditionNotes: patch.conditionNotes?.trim() || null }
          : {}),
      },
    });
  });
}

export async function addDamagePoint(
  handoverId: string,
  point: NewDamagePoint,
  actorId: string | null,
) {
  const resolved = resolveDamagePoint(point);
  return prisma.$transaction(async (tx) => {
    await openDraft(tx, handoverId);
    return tx.damagePoint.create({ data: { handoverId, ...resolved, createdById: actorId } });
  });
}

export async function removeDamagePoint(damagePointId: string) {
  return prisma.$transaction(async (tx) => {
    const point = await tx.damagePoint.findUnique({
      where: { id: damagePointId },
      select: { handoverId: true },
    });
    if (!point) throw new HandoverRuleError("damagePointNotFound");
    await openDraft(tx, point.handoverId);
    // Photographs of a removed mark go with it: the document engine cascades nothing, so
    // they are deleted here rather than left pointing at a row that no longer exists.
    await tx.document.deleteMany({ where: { ownerType: "DAMAGE_POINT", ownerId: damagePointId } });
    await tx.damagePoint.delete({ where: { id: damagePointId } });
  });
}

/** A draft can be thrown away; a signed form cannot. */
export async function discardHandover(handoverId: string) {
  return prisma.$transaction(async (tx) => {
    await openDraft(tx, handoverId);
    const points = await tx.damagePoint.findMany({ where: { handoverId }, select: { id: true } });
    await tx.document.deleteMany({
      where: {
        OR: [
          { ownerType: "HANDOVER", ownerId: handoverId },
          { ownerType: "DAMAGE_POINT", ownerId: { in: points.map((point) => point.id) } },
        ],
      },
    });
    await tx.handover.update({ where: { id: handoverId }, data: { deletedAt: new Date() } });
  });
}

export interface HandoverSignatures {
  customerSignatureKey: string;
  customerSignatureName: string;
  staffSignatureKey: string;
  staffSignatureName: string;
}

/**
 * Take both signatures and close the form.
 *
 * Both together, never one at a time: a form holding only the customer's signature is one
 * DrivenX has not agreed to, and one holding only staff's is one the customer never saw.
 * The odometer becomes the fleet's mileage at this point, checked against the vehicle the
 * same way every other reading is.
 */
export async function signHandover(
  handoverId: string,
  signatures: HandoverSignatures,
  actorId: string | null,
) {
  const customerName = signatures.customerSignatureName.trim();
  const staffName = signatures.staffSignatureName.trim();
  if (
    !customerName ||
    !staffName ||
    !signatures.customerSignatureKey ||
    !signatures.staffSignatureKey
  ) {
    throw new HandoverRuleError("signatureIncomplete");
  }

  return prisma.$transaction(async (tx) => {
    const handover = await tx.handover.findFirst({
      where: { id: handoverId, deletedAt: null },
      select: {
        id: true,
        status: true,
        vehicleId: true,
        odometerKm: true,
        occurredAt: true,
        type: true,
      },
    });
    if (!handover) throw new HandoverRuleError("handoverNotFound");
    if (handover.status === "SIGNED") throw new HandoverRuleError("handoverSigned");

    const vehicle = await tx.vehicle.findFirst({
      where: { id: handover.vehicleId, deletedAt: null },
      select: { currentMileageKm: true },
    });
    if (!vehicle) throw new HandoverRuleError("handoverNotFound");

    const check = validateMileageReading(vehicle.currentMileageKm, handover.odometerKm);
    if (!check.valid) throw new HandoverRuleError("odometerBackwards");

    const now = new Date();
    const signed = await tx.handover.update({
      where: { id: handoverId },
      data: {
        status: "SIGNED",
        customerSignatureKey: signatures.customerSignatureKey,
        customerSignatureName: customerName,
        customerSignedAt: now,
        staffSignatureKey: signatures.staffSignatureKey,
        staffSignatureName: staffName,
        staffSignedAt: now,
      },
    });

    // The reading a customer countersigned is the most reliable one the car gets.
    await tx.vehicle.update({
      where: { id: handover.vehicleId },
      data: { currentMileageKm: handover.odometerKm },
    });
    await tx.mileageReading.create({
      data: {
        vehicleId: handover.vehicleId,
        readingKm: handover.odometerKm,
        readAt: handover.occurredAt,
        note: handover.type === "HANDOVER" ? "Handover" : "Return",
        recordedById: actorId,
      },
    });

    return signed;
  });
}

const WITH_POINTS = {
  damagePoints: { orderBy: [{ createdAt: "asc" }] },
} satisfies Prisma.HandoverInclude;

export async function handoversForContract(contractId: string) {
  return prisma.handover.findMany({
    where: { contractId, deletedAt: null },
    include: WITH_POINTS,
    orderBy: { occurredAt: "asc" },
  });
}

export async function handoverById(handoverId: string) {
  return prisma.handover.findFirst({
    where: { id: handoverId, deletedAt: null },
    include: {
      ...WITH_POINTS,
      contract: { include: { customer: true, vehicle: true } },
    },
  });
}

export interface ContractExcessMileage extends ExcessMileageResult {
  handoverKm: number;
  returnKm: number;
}

/**
 * What the extra kilometres on a finished contract come to (P2-04, feeding P2-12).
 *
 * Null until both forms exist and both are signed. An unsigned reading is one nobody has
 * agreed to, and a settlement line raised from it is a charge the customer can refuse
 * with the paperwork in their hand.
 */
export async function excessMileageForContract(
  contractId: string,
): Promise<ContractExcessMileage | null> {
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, deletedAt: null },
    select: {
      mileageAllowanceKm: true,
      excessMileageRateFils: true,
      handovers: {
        where: { deletedAt: null, status: "SIGNED" },
        select: { type: true, odometerKm: true },
      },
    },
  });
  if (!contract) return null;

  const out = contract.handovers.find((row) => row.type === "HANDOVER");
  const back = contract.handovers.find((row) => row.type === "RETURN");
  if (!out || !back) return null;

  return {
    handoverKm: out.odometerKm,
    returnKm: back.odometerKm,
    ...excessMileageCharge({
      handoverKm: out.odometerKm,
      returnKm: back.odometerKm,
      allowanceKm: contract.mileageAllowanceKm,
      rateFils: contract.excessMileageRateFils,
    }),
  };
}
