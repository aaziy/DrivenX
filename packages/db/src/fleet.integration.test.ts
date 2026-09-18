/**
 * Fleet writes against a real database (milestone 1B).
 *
 * Three kinds of guarantee are proven here, and each needs Postgres to be meaningful:
 * constraints the database enforces whatever the caller does, uniqueness, and the
 * compare-and-set that decides which of two simultaneous changes wins.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { IllegalVehicleTransitionError } from "@drivenx/core";

import {
  changeVehicleStatus,
  ConcurrentVehicleChangeError,
  createVehicle,
  MileageRejectedError,
  recordMileage,
  VehicleNotFoundError,
  VehicleStatusManagedByContractError,
  type NewVehicle,
} from "./fleet";
import { prisma } from "./index";

let supplierId: string;
let serial = 0;

/** A valid vehicle whose plate and VIN do not collide with the others in the test. */
function vehicle(overrides: Partial<NewVehicle> = {}): NewVehicle {
  serial += 1;
  return {
    make: "Toyota",
    model: "Camry",
    year: 2024,
    plateEmirate: "DUBAI",
    plateCode: "A",
    plateNumber: String(10000 + serial),
    vin: `JTDBT4K3${String(serial).padStart(9, "0")}`,
    currentMileageKm: 0,
    ownershipType: "COMPANY_OWNED",
    ...overrides,
  };
}

beforeEach(async () => {
  const supplier = await prisma.supplier.create({
    data: { code: `SUP-T${Date.now()}`, companyName: "Gulf Premier Motors" },
  });
  supplierId = supplier.id;
});

describe("the database itself", () => {
  it("refuses a B2B vehicle with no supplier, even written directly", async () => {
    // P1B-04 asks for this in the database, not only the form: a script or a future API
    // does not read the form's validation. Written without the service to prove that.
    await expect(
      prisma.vehicle.create({
        data: { ...vehicle({ ownershipType: "B2B_SUPPLIER" }), code: "VEH-RAW1" },
      }),
    ).rejects.toThrow(/vehicles_b2b_requires_supplier/);
  });

  it("accepts a B2B vehicle once it has a supplier", async () => {
    const created = await createVehicle(
      vehicle({ ownershipType: "B2B_SUPPLIER", supplierId }),
      null,
    );
    expect(created.supplierId).toBe(supplierId);
  });

  it("refuses a second vehicle with the same VIN", async () => {
    const first = vehicle();
    await createVehicle(first, null);

    await expect(createVehicle(vehicle({ vin: first.vin }), null)).rejects.toThrow();
  });

  it("treats the same plate in two emirates as two cars", async () => {
    // "A 12345" in Dubai and in Abu Dhabi are different registrations.
    await createVehicle(vehicle({ plateEmirate: "DUBAI", plateNumber: "55555" }), null);
    await expect(
      createVehicle(vehicle({ plateEmirate: "ABU_DHABI", plateNumber: "55555" }), null),
    ).resolves.toBeDefined();
  });

  it("refuses the same plate twice in the same emirate", async () => {
    await createVehicle(vehicle({ plateNumber: "77777" }), null);
    await expect(createVehicle(vehicle({ plateNumber: "77777" }), null)).rejects.toThrow();
  });

  it("refuses a model year that is a typo", async () => {
    await expect(createVehicle(vehicle({ year: 2206 }), null)).rejects.toThrow(
      /vehicles_year_plausible/,
    );
  });
});

describe("createVehicle", () => {
  it("issues a fleet code and starts the timeline where the vehicle starts", async () => {
    const created = await createVehicle(vehicle({ currentMileageKm: 12_500 }), null);

    expect(created.code).toMatch(/^VEH-\d{5,}$/);

    const history = await prisma.vehicleStatusChange.findMany({
      where: { vehicleId: created.id },
    });
    expect(history).toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: "AVAILABLE" }),
    ]);

    const readings = await prisma.mileageReading.findMany({ where: { vehicleId: created.id } });
    expect(readings.map((r) => r.readingKm)).toEqual([12_500]);
  });

  it("records no odometer reading for a car that arrives at zero", async () => {
    const created = await createVehicle(vehicle({ currentMileageKm: 0 }), null);
    expect(await prisma.mileageReading.count({ where: { vehicleId: created.id } })).toBe(0);
  });
});

describe("changeVehicleStatus", () => {
  it("moves the vehicle and records why", async () => {
    const created = await createVehicle(vehicle(), null);

    await changeVehicleStatus(created.id, "MAINTENANCE", { reason: "Service due", actorId: null });

    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: created.id } })).status).toBe(
      "MAINTENANCE",
    );
    const latest = await prisma.vehicleStatusChange.findFirstOrThrow({
      where: { vehicleId: created.id },
      orderBy: { changedAt: "desc" },
    });
    expect(latest).toMatchObject({
      fromStatus: "AVAILABLE",
      toStatus: "MAINTENANCE",
      reason: "Service due",
    });
  });

  it("refuses an illegal move and changes nothing", async () => {
    const created = await createVehicle(vehicle(), null);
    await changeVehicleStatus(created.id, "SOLD", { actorId: null });

    await expect(changeVehicleStatus(created.id, "RENTED", { actorId: null })).rejects.toThrow(
      IllegalVehicleTransitionError,
    );

    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: created.id } })).status).toBe(
      "SOLD",
    );
    // Joined, then sold — no half-written third entry from the refused attempt.
    expect(await prisma.vehicleStatusChange.count({ where: { vehicleId: created.id } })).toBe(2);
  });

  it("keeps a car leased from a supplier off plain rentals, and sells it only at buyout", async () => {
    const leased = await createVehicle(
      vehicle({ ownershipType: "B2B_SUPPLIER", supplierId }),
      null,
    );

    await expect(
      changeVehicleStatus(leased.id, "RENTED", { actorId: null }),
    ).rejects.toMatchObject({ name: "IllegalVehicleTransitionError", blockedByOwnership: true });
    await expect(changeVehicleStatus(leased.id, "SOLD", { actorId: null })).rejects.toThrow(
      IllegalVehicleTransitionError,
    );

    // Lease-to-own is set by a contract; here the service is called as a contract would.
    await changeVehicleStatus(leased.id, "LEASE_TO_OWN", { actorId: null, viaContract: true });
    await changeVehicleStatus(leased.id, "SOLD", { actorId: null });

    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: leased.id } })).status).toBe(
      "SOLD",
    );
  });

  it("lets exactly one of two simultaneous changes win", async () => {
    // Two staff act on the same available car at once. Without the compare-and-set both
    // would write, and the timeline would contradict itself.
    const created = await createVehicle(vehicle(), null);

    const results = await Promise.allSettled([
      changeVehicleStatus(created.id, "RESERVED", { actorId: null }),
      changeVehicleStatus(created.id, "MAINTENANCE", { actorId: null }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConcurrentVehicleChangeError,
    );

    // Joined, plus the single winning change.
    expect(await prisma.vehicleStatusChange.count({ where: { vehicleId: created.id } })).toBe(2);
  });

  it("refuses to put a car on Rented or Lease-to-own by hand", async () => {
    // INV-9: a car is out because a live contract says so. Set directly, the fleet would
    // show a car out on a contract that exists nowhere.
    const created = await createVehicle(vehicle(), null);

    for (const to of ["RENTED", "LEASE_TO_OWN"] as const) {
      await expect(changeVehicleStatus(created.id, to, { actorId: null })).rejects.toBeInstanceOf(
        VehicleStatusManagedByContractError,
      );
    }
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("AVAILABLE");
  });

  it("does not act on a removed vehicle", async () => {
    const created = await createVehicle(vehicle(), null);
    await prisma.vehicle.update({ where: { id: created.id }, data: { deletedAt: new Date() } });

    await expect(
      changeVehicleStatus(created.id, "MAINTENANCE", { actorId: null }),
    ).rejects.toThrow(VehicleNotFoundError);
  });
});

describe("recordMileage", () => {
  it("moves the odometer forward and keeps the reading", async () => {
    const created = await createVehicle(vehicle({ currentMileageKm: 10_000 }), null);

    await recordMileage(created.id, 11_250, { actorId: null });

    expect(
      (await prisma.vehicle.findUniqueOrThrow({ where: { id: created.id } })).currentMileageKm,
    ).toBe(11_250);
    expect(await prisma.mileageReading.count({ where: { vehicleId: created.id } })).toBe(2);
  });

  it("refuses a reading that goes backwards, and changes nothing", async () => {
    // Excess mileage is settled against this at return; backwards is money lost.
    const created = await createVehicle(vehicle({ currentMileageKm: 10_000 }), null);

    await expect(recordMileage(created.id, 9_999, { actorId: null })).rejects.toMatchObject({
      name: "MileageRejectedError",
      code: "backwards",
      params: { current: 10_000 },
    });

    expect(
      (await prisma.vehicle.findUniqueOrThrow({ where: { id: created.id } })).currentMileageKm,
    ).toBe(10_000);
    expect(await prisma.mileageReading.count({ where: { vehicleId: created.id } })).toBe(1);
  });

  it("never lets a lower reading overwrite a higher one written at the same moment", async () => {
    const created = await createVehicle(vehicle({ currentMileageKm: 10_000 }), null);

    await Promise.allSettled([
      recordMileage(created.id, 15_000, { actorId: null }),
      recordMileage(created.id, 12_000, { actorId: null }),
    ]);

    // Whichever order they landed in, the odometer ends at the higher reading — never
    // pulled back to 12,000 by the one that arrived second.
    expect(
      (await prisma.vehicle.findUniqueOrThrow({ where: { id: created.id } })).currentMileageKm,
    ).toBe(15_000);
  });

  it("rejects a reading as a typed error the form can translate", async () => {
    const created = await createVehicle(vehicle(), null);
    await expect(recordMileage(created.id, -5, { actorId: null })).rejects.toBeInstanceOf(
      MileageRejectedError,
    );
  });
});
