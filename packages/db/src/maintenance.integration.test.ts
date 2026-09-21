/**
 * Maintenance against a real database (P2-05, P2-06).
 *
 * The exit test Phase 2 sets: a maintenance cost posted today changes vehicle
 * profitability and monthly profit by exactly that amount and by nothing else — with no
 * change to the reporting layer built in 1E.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { Money } from "@drivenx/core";

import { activateContract, createContract, issueDueInstallments } from "./contracts";
import { createVehicle } from "./fleet";
import { prisma } from "./index";
import { monthResult } from "./kpis";
import { MaintenanceRuleError, recordMaintenance, serviceStatus, vehiclesDueForService } from "./maintenance";
import { profitReport } from "./reports";

const aed = (value: string) => Money.parse(value);

let customerId: string;
let vehicleId: string;
let serial = 0;

async function car(mileage = 30_000) {
  serial += 1;
  return createVehicle(
    {
      make: "Toyota",
      model: "Hilux",
      year: 2024,
      plateEmirate: "DUBAI",
      plateCode: "M",
      plateNumber: String(31000 + serial),
      vin: `JTMMNT${String(serial).padStart(11, "0")}`,
      currentMileageKm: mileage,
      ownershipType: "COMPANY_OWNED",
    },
    null,
  );
}

const work = (overrides: Partial<Parameters<typeof recordMaintenance>[0]> = {}) => ({
  vehicleId,
  type: "SERVICE" as const,
  servicedOn: "2026-03-10",
  odometerKm: 35_000,
  vendor: "Al Habtoor Motors",
  vendorInvoiceNumber: "GAR-119",
  costNetFils: aed("800"),
  nextServiceOn: "2026-09-10",
  nextServiceKm: 45_000,
  ...overrides,
});

beforeEach(async () => {
  customerId = (
    await prisma.customer.create({ data: { code: `CUS-M${Date.now()}`, fullName: "Adel", mobile: "+971501234577" } })
  ).id;
  vehicleId = (await car()).id;
});

describe("recording work", () => {
  it("costs the bill net and takes the garage's odometer reading with it", async () => {
    const record = await recordMaintenance(work(), null);
    expect(record).toMatchObject({
      costNetFils: aed("800"),
      costVatFils: aed("40"),
      costFils: aed("840"),
      odometerKm: 35_000,
    });

    const entry = await prisma.ledgerEntry.findFirstOrThrow({
      where: { sourceType: "MaintenanceRecord", sourceId: record.id },
    });
    expect(entry).toMatchObject({ direction: "COST", category: "cost.maintenance", amountFils: aed("800"), periodMonth: 202603 });

    // The car's mileage moved with it, and the reading is on its history.
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    expect(vehicle.currentMileageKm).toBe(35_000);
    expect(await prisma.mileageReading.count({ where: { vehicleId, readingKm: 35_000 } })).toBe(1);
  });

  it("refuses an odometer below the car's last reading, and a next service behind this one", async () => {
    await expect(recordMaintenance(work({ odometerKm: 29_000 }), null)).rejects.toMatchObject({
      code: "odometerBelowCurrent",
    });
    await expect(recordMaintenance(work({ nextServiceKm: 34_000 }), null)).rejects.toMatchObject({
      code: "nextServiceBehind",
    });
    await expect(recordMaintenance(work({ nextServiceOn: "2026-03-01" }), null)).rejects.toMatchObject({
      code: "nextServiceBehind",
    });
    await expect(recordMaintenance(work({ vendor: "  " }), null)).rejects.toBeInstanceOf(MaintenanceRuleError);
  });

  it("carries free work without inventing a cost entry", async () => {
    const record = await recordMaintenance(work({ costNetFils: 0n, vendorInvoiceNumber: null }), null);
    expect(record.costFils).toBe(0n);
    expect(await prisma.ledgerEntry.count({ where: { sourceId: record.id } })).toBe(0);
  });

  it("attributes the cost to the contract the car was out on that day", async () => {
    const draft = await createContract(
      {
        customerId,
        vehicleId,
        type: "LONG_TERM_RENTAL",
        startDate: "2026-01-01",
        durationMonths: 12,
        monthlyRentalFils: aed("3000"),
      },
      null,
    );
    await activateContract(draft.id, { actorId: null, today: "2026-01-01" });
    const record = await recordMaintenance(work(), null);

    expect(record.contractId).toBe(draft.id);
    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { sourceId: record.id } });
    expect(entry.contractId).toBe(draft.id);
  });
});

describe("when the next service is due (P2-06)", () => {
  it("is quiet until the date or the distance comes near, then says which", async () => {
    await recordMaintenance(work(), null);

    expect(await serviceStatus(vehicleId, "2026-04-01")).toMatchObject({ dueSoon: false, overdue: false });
    // A fortnight before the date.
    expect(await serviceStatus(vehicleId, "2026-08-30")).toMatchObject({ dueSoon: true, overdue: false });
    // Past it.
    expect(await serviceStatus(vehicleId, "2026-09-11")).toMatchObject({ overdue: true });

    // Or by distance: within 500 km of the marker.
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { currentMileageKm: 44_600 } });
    expect(await serviceStatus(vehicleId, "2026-04-01")).toMatchObject({ dueSoon: true, kmRemaining: 400 });
  });

  it("lists the cars needing attention, overdue first, and ignores cars that have left", async () => {
    await recordMaintenance(work(), null);
    const other = await car(10_000);
    await recordMaintenance(
      work({ vehicleId: other.id, odometerKm: 12_000, nextServiceOn: "2026-04-01", nextServiceKm: 20_000 }),
      null,
    );

    const due = await vehiclesDueForService("2026-09-11");
    const ids = due.map((row) => row.vehicle.id);
    expect(ids).toContain(vehicleId);
    expect(ids).toContain(other.id);
    expect(due[0]?.due.overdue).toBe(true);

    // A sold car is not a reminder.
    await prisma.vehicle.update({ where: { id: other.id }, data: { status: "SOLD" } });
    expect((await vehiclesDueForService("2026-09-11")).map((row) => row.vehicle.id)).not.toContain(other.id);
  });

  it("follows the latest record, not the one it replaced", async () => {
    await recordMaintenance(work(), null);
    expect(await serviceStatus(vehicleId, "2026-09-11")).toMatchObject({ overdue: true });

    await recordMaintenance(
      work({ servicedOn: "2026-09-12", odometerKm: 44_000, nextServiceOn: "2027-03-12", nextServiceKm: 54_000 }),
      null,
    );
    expect(await serviceStatus(vehicleId, "2026-09-13")).toMatchObject({ overdue: false, dueSoon: false });
  });
});

describe("the books", () => {
  it("move vehicle profit and monthly profit by the cost, and by nothing else (Phase 2 exit)", async () => {
    const draft = await createContract(
      {
        customerId,
        vehicleId,
        type: "LONG_TERM_RENTAL",
        startDate: "2026-03-01",
        durationMonths: 12,
        monthlyRentalFils: aed("3000"),
      },
      null,
    );
    await activateContract(draft.id, { actorId: null, today: "2026-03-01" });
    await issueDueInstallments("2026-03-01");

    const before = await profitReport("vehicle", 202603, 202603);
    const beforeRow = before.rows.find((row) => row.key === vehicleId);
    const beforeMonth = await monthResult("2026-03-15");

    await recordMaintenance(work(), null);

    const after = await profitReport("vehicle", 202603, 202603);
    const afterRow = after.rows.find((row) => row.key === vehicleId);
    const afterMonth = await monthResult("2026-03-15");

    // Exactly the net bill, in cost, and nowhere else.
    expect((afterRow?.costFils ?? 0n) - (beforeRow?.costFils ?? 0n)).toBe(aed("800"));
    expect((afterRow?.otherCostFils ?? 0n) - (beforeRow?.otherCostFils ?? 0n)).toBe(aed("800"));
    expect(afterRow?.revenueFils).toBe(beforeRow?.revenueFils);
    expect((beforeRow?.profitFils ?? 0n) - (afterRow?.profitFils ?? 0n)).toBe(aed("800"));
    expect(beforeMonth.profitFils - afterMonth.profitFils).toBe(aed("800"));
    expect(afterMonth.revenueFils).toBe(beforeMonth.revenueFils);
  });
});
