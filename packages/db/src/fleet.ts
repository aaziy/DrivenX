/**
 * Fleet writes that must stay consistent with each other (milestone 1B).
 *
 * A status change is two facts — the vehicle's current status and the timeline entry that
 * explains it — and a mileage reading is two facts too. Written separately, a failure
 * between them leaves a vehicle whose timeline disagrees with its own status. So each
 * operation is one transaction, and each guards against a concurrent change with a
 * compare-and-set: the update only applies if the row still says what was read.
 *
 * The rules themselves live in @drivenx/core and are pure; this module is the I/O.
 */

import {
  assertTransition,
  CONTRACT_MANAGED_STATUSES,
  validateMileageReading,
  type MileageIssueCode,
  type VehicleStatus,
} from "@drivenx/core";

import type { Emirate, OwnershipType } from "../generated/client";
import { prisma } from "./index";
import { nextVehicleCode } from "./parties/codes";

export class VehicleNotFoundError extends Error {
  constructor(readonly vehicleId: string) {
    super(`Vehicle not found: ${vehicleId}`);
    this.name = "VehicleNotFoundError";
  }
}

/**
 * Someone else changed the vehicle between reading it and writing it. Surfaced rather than
 * retried: the other person's change may make this one wrong — a car that was just rented
 * should not then be silently sent to the workshop.
 */
export class ConcurrentVehicleChangeError extends Error {
  constructor(readonly vehicleId: string) {
    super(`Vehicle ${vehicleId} changed while this change was being made`);
    this.name = "ConcurrentVehicleChangeError";
  }
}

/** Rented and Lease-to-own come from activating a contract, never from the status control. */
export class VehicleStatusManagedByContractError extends Error {
  constructor(readonly to: VehicleStatus) {
    super(`A vehicle is put into ${to} by activating a contract, not directly`);
    this.name = "VehicleStatusManagedByContractError";
  }
}

export class MileageRejectedError extends Error {
  constructor(
    readonly code: MileageIssueCode,
    readonly params?: Record<string, number>,
  ) {
    super(`Mileage reading rejected: ${code}`);
    this.name = "MileageRejectedError";
  }
}

export interface NewVehicle {
  make: string;
  model: string;
  year: number;
  variant?: string | null;
  colour?: string | null;
  plateEmirate: Emirate;
  plateCode: string;
  plateNumber: string;
  vin: string;
  currentMileageKm: number;
  ownershipType: OwnershipType;
  supplierId?: string | null;
  sourceDate?: Date | null;
  purchasePriceFils?: bigint | null;
  supplierMonthlyCostFils?: bigint | null;
  notes?: string | null;
}

/**
 * Add a vehicle, with its first timeline entry and — if it arrives with miles on it — its
 * first odometer reading, so the history starts where the vehicle did.
 *
 * The code is allocated before the transaction: a sequence does not roll back, so a failed
 * create burns a number either way, and holding it outside keeps the transaction short.
 */
export async function createVehicle(input: NewVehicle, actorId: string | null) {
  const code = await nextVehicleCode();

  return prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.create({
      data: { ...input, code, createdById: actorId },
    });

    // No English stored: a null "from" is rendered as "joined the fleet" in the reader's
    // language, where a stored sentence would be English forever.
    await tx.vehicleStatusChange.create({
      data: {
        vehicleId: vehicle.id,
        fromStatus: null,
        toStatus: vehicle.status,
        changedById: actorId,
      },
    });

    if (input.currentMileageKm > 0) {
      await tx.mileageReading.create({
        data: {
          vehicleId: vehicle.id,
          readingKm: input.currentMileageKm,
          recordedById: actorId,
        },
      });
    }

    return vehicle;
  });
}

export async function changeVehicleStatus(
  vehicleId: string,
  to: VehicleStatus,
  options: { reason?: string | null; actorId: string | null; viaContract?: boolean },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.findFirst({
      where: { id: vehicleId, deletedAt: null },
      select: { status: true, ownershipType: true },
    });
    if (!vehicle) throw new VehicleNotFoundError(vehicleId);

    // Throws IllegalVehicleTransitionError, which names both ends for the message and
    // says whether the car's ownership is the reason. Checked first, so a move that is
    // illegal for any reason is reported as that, not as contract-managed.
    assertTransition(vehicle.status, to, vehicle.ownershipType);

    if (CONTRACT_MANAGED_STATUSES.includes(to) && !options.viaContract) {
      throw new VehicleStatusManagedByContractError(to);
    }

    const updated = await tx.vehicle.updateMany({
      where: { id: vehicleId, status: vehicle.status, deletedAt: null },
      data: { status: to },
    });
    if (updated.count === 0) throw new ConcurrentVehicleChangeError(vehicleId);

    await tx.vehicleStatusChange.create({
      data: {
        vehicleId,
        fromStatus: vehicle.status,
        toStatus: to,
        reason: options.reason ?? null,
        changedById: options.actorId,
      },
    });
  });
}

export async function recordMileage(
  vehicleId: string,
  readingKm: number,
  options: { note?: string | null; actorId: string | null; readAt?: Date },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.findFirst({
      where: { id: vehicleId, deletedAt: null },
      select: { currentMileageKm: true },
    });
    if (!vehicle) throw new VehicleNotFoundError(vehicleId);

    const check = validateMileageReading(vehicle.currentMileageKm, readingKm);
    if (!check.valid) throw new MileageRejectedError(check.code, check.params);

    // Compare-and-set on the odometer itself: if a higher reading landed meanwhile, this
    // one would take the mileage backwards, so it is refused rather than applied.
    const updated = await tx.vehicle.updateMany({
      where: { id: vehicleId, currentMileageKm: { lte: readingKm }, deletedAt: null },
      data: { currentMileageKm: readingKm },
    });
    if (updated.count === 0) throw new ConcurrentVehicleChangeError(vehicleId);

    await tx.mileageReading.create({
      data: {
        vehicleId,
        readingKm,
        note: options.note ?? null,
        recordedById: options.actorId,
        ...(options.readAt ? { readAt: options.readAt } : {}),
      },
    });
  });
}
