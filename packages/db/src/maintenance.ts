/**
 * Maintenance (P2-05, P2-06, SOW §12).
 *
 * What a car cost to keep on the road, and when it is next due. The bill is held net with
 * its VAT beside it, because input VAT is recoverable (client, 2026-09-20), and the net is
 * posted to `cost.maintenance` on the day of the work — against the car, and against the
 * contract it was out on that day, so both profitability views carry it.
 *
 * A service is also a mileage reading: the odometer at the garage is the most reliable
 * reading a car gets, so it updates the vehicle in the same transaction rather than
 * leaving staff to enter it twice.
 */

import { serviceDue, validateMileageReading, vatOn, type IsoDate, type ServiceDue } from "@drivenx/core";

import type { MaintenanceType } from "../generated/client";
import { fromDbDate, toDbDate } from "./dates";
import { prisma } from "./index";
import { postToLedger } from "./ledger";

export type MaintenanceRuleCode =
  | "vehicleNotFound"
  | "recordNotFound"
  | "invalidRecord"
  | "odometerBelowCurrent"
  | "nextServiceBehind";

export class MaintenanceRuleError extends Error {
  constructor(readonly code: MaintenanceRuleCode) {
    super(`Maintenance refused: ${code}`);
    this.name = "MaintenanceRuleError";
  }
}

export interface NewMaintenance {
  vehicleId: string;
  type: MaintenanceType;
  servicedOn: IsoDate;
  odometerKm: number;
  vendor: string;
  vendorInvoiceNumber?: string | null;
  description?: string | null;
  /** The garage's bill, net of VAT. */
  costNetFils: bigint;
  vatBasisPoints?: number;
  nextServiceOn?: IsoDate | null;
  nextServiceKm?: number | null;
  notes?: string | null;
}

/**
 * Record work done, cost it, and take the odometer reading with it.
 *
 * Idempotent through the ledger's uniqueness on (source, category): the same record
 * cannot be costed twice.
 */
export async function recordMaintenance(input: NewMaintenance, actorId: string | null) {
  const vendor = input.vendor.trim();
  if (!vendor || input.costNetFils < 0n || !Number.isInteger(input.odometerKm) || input.odometerKm < 0) {
    throw new MaintenanceRuleError("invalidRecord");
  }
  if (input.nextServiceKm != null && input.nextServiceKm <= input.odometerKm) {
    throw new MaintenanceRuleError("nextServiceBehind");
  }
  if (input.nextServiceOn != null && input.nextServiceOn <= input.servicedOn) {
    throw new MaintenanceRuleError("nextServiceBehind");
  }

  const vatBasisPoints = input.vatBasisPoints ?? 500;
  const costVatFils = vatOn(input.costNetFils, vatBasisPoints);

  return prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.findFirst({
      where: { id: input.vehicleId, deletedAt: null },
      select: { id: true, currentMileageKm: true },
    });
    if (!vehicle) throw new MaintenanceRuleError("vehicleNotFound");

    // The same rule the mileage screen uses: an odometer does not run backwards.
    const check = validateMileageReading(vehicle.currentMileageKm, input.odometerKm);
    if (!check.valid) throw new MaintenanceRuleError("odometerBelowCurrent");

    // The contract the car was out on that day, so contract profitability carries it too.
    const contract = await tx.contract.findFirst({
      where: {
        vehicleId: vehicle.id,
        deletedAt: null,
        startDate: { lte: toDbDate(input.servicedOn) },
        endDate: { gte: toDbDate(input.servicedOn) },
        status: { in: ["ACTIVE", "OVERDUE", "COMPLETED", "CANCELLED"] },
      },
      orderBy: { startDate: "desc" },
      select: { id: true, customerId: true },
    });

    const record = await tx.maintenanceRecord.create({
      data: {
        vehicleId: vehicle.id,
        type: input.type,
        servicedOn: toDbDate(input.servicedOn),
        odometerKm: input.odometerKm,
        vendor,
        vendorInvoiceNumber: input.vendorInvoiceNumber?.trim() || null,
        description: input.description?.trim() || null,
        costNetFils: input.costNetFils,
        vatBasisPoints,
        costVatFils,
        costFils: input.costNetFils + costVatFils,
        nextServiceOn: input.nextServiceOn ? toDbDate(input.nextServiceOn) : null,
        nextServiceKm: input.nextServiceKm ?? null,
        contractId: contract?.id ?? null,
        notes: input.notes?.trim() || null,
        createdById: actorId,
      },
    });

    // The garage's reading is a mileage reading like any other.
    await tx.vehicle.update({ where: { id: vehicle.id }, data: { currentMileageKm: input.odometerKm } });
    await tx.mileageReading.create({
      data: {
        vehicleId: vehicle.id,
        readingKm: input.odometerKm,
        readAt: new Date(`${input.servicedOn}T00:00:00Z`),
        note: vendor,
        recordedById: actorId,
      },
    });

    if (record.costNetFils > 0n) {
      await postToLedger(tx, {
        occurredOn: input.servicedOn,
        direction: "COST",
        category: "cost.maintenance",
        // Net: the VAT on the garage's bill is reclaimed, so it is not a cost.
        amountFils: record.costNetFils,
        vehicleId: vehicle.id,
        contractId: contract?.id ?? null,
        customerId: contract?.customerId ?? null,
        sourceType: "MaintenanceRecord",
        sourceId: record.id,
        memo: `${vendor}${record.vendorInvoiceNumber ? ` ${record.vendorInvoiceNumber}` : ""}`,
      });
    }

    return record;
  });
}

export interface ServiceStatus extends ServiceDue {
  recordId: string;
  vehicleId: string;
}

/**
 * The service standing on a car: its latest record's markers against today and the
 * odometer. Only the latest matters — an older record's markers were superseded by the
 * work that followed.
 */
export async function serviceStatus(vehicleId: string, today: IsoDate): Promise<ServiceStatus | null> {
  const [record, vehicle] = await Promise.all([
    prisma.maintenanceRecord.findFirst({
      where: { vehicleId, deletedAt: null },
      orderBy: [{ servicedOn: "desc" }, { createdAt: "desc" }],
    }),
    prisma.vehicle.findFirst({ where: { id: vehicleId }, select: { currentMileageKm: true } }),
  ]);
  if (!record || !vehicle) return null;

  return {
    recordId: record.id,
    vehicleId,
    ...serviceDue(
      {
        nextServiceOn: record.nextServiceOn ? fromDbDate(record.nextServiceOn) : null,
        nextServiceKm: record.nextServiceKm,
      },
      { today, odometerKm: vehicle.currentMileageKm },
    ),
  };
}

/**
 * Cars whose next service is near or passed (P2-06).
 *
 * Only the latest record per car is considered, and only cars still in the fleet: a sold
 * car's service history is not a reminder.
 */
export async function vehiclesDueForService(today: IsoDate) {
  const vehicles = await prisma.vehicle.findMany({
    where: { deletedAt: null, status: { notIn: ["SOLD", "INACTIVE"] }, maintenance: { some: { deletedAt: null } } },
    select: {
      id: true,
      code: true,
      make: true,
      model: true,
      plateCode: true,
      plateNumber: true,
      currentMileageKm: true,
      maintenance: {
        where: { deletedAt: null },
        orderBy: [{ servicedOn: "desc" }, { createdAt: "desc" }],
        take: 1,
      },
    },
  });

  return vehicles
    .map((vehicle) => {
      const record = vehicle.maintenance[0];
      if (!record) return null;
      const due = serviceDue(
        {
          nextServiceOn: record.nextServiceOn ? fromDbDate(record.nextServiceOn) : null,
          nextServiceKm: record.nextServiceKm,
        },
        { today, odometerKm: vehicle.currentMileageKm },
      );
      return due.overdue || due.dueSoon ? { vehicle, record, due } : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => Number(b.due.overdue) - Number(a.due.overdue));
}
