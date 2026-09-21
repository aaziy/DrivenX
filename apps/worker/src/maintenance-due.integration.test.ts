/**
 * The nightly service check (P2-06) against a real database.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { Money } from "@drivenx/core";
import { createVehicle, prisma, recordMaintenance } from "@drivenx/db";

import { runMaintenanceDue } from "./maintenance-due";

let serial = 0;

async function carWithService(overrides: { nextServiceOn?: string | null; nextServiceKm?: number | null }) {
  serial += 1;
  const vehicle = await createVehicle(
    {
      make: "Toyota",
      model: "Hiace",
      year: 2024,
      plateEmirate: "DUBAI",
      plateCode: "W",
      plateNumber: String(41000 + serial),
      vin: `JTWSRV${String(Date.now()).slice(-11)}`,
      currentMileageKm: 30_000,
      ownershipType: "COMPANY_OWNED",
    },
    null,
  );
  await recordMaintenance(
    {
      vehicleId: vehicle.id,
      type: "SERVICE",
      servicedOn: "2026-03-01",
      odometerKm: 30_000,
      vendor: "Fleet Garage",
      costNetFils: Money.parse("500"),
      nextServiceOn: overrides.nextServiceOn ?? null,
      nextServiceKm: overrides.nextServiceKm ?? null,
    },
    null,
  );
  return vehicle;
}

const alertsFor = (vehicleId: string) =>
  prisma.notification.findMany({ where: { type: "MAINTENANCE_DUE", entityId: vehicleId } });

beforeEach(async () => {
  serial += 1;
});

describe("runMaintenanceDue", () => {
  it("warns once as the date nears, again when it passes, and never twice for the same state", async () => {
    const vehicle = await carWithService({ nextServiceOn: "2026-09-10" });

    // Comfortably ahead: nothing.
    await runMaintenanceDue(new Date("2026-07-01T06:00:00Z"));
    expect(await alertsFor(vehicle.id)).toHaveLength(0);

    // Within the fortnight: one warning, however many times the job runs.
    await runMaintenanceDue(new Date("2026-09-01T06:00:00Z"));
    await runMaintenanceDue(new Date("2026-09-02T06:00:00Z"));
    const warned = await alertsFor(vehicle.id);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatchObject({ severity: "WARNING", title: "Service due soon" });
    expect(warned[0]?.body).toContain("Hiace");

    // Past it: a second, critical alert, and no more after that.
    await runMaintenanceDue(new Date("2026-09-20T06:00:00Z"));
    await runMaintenanceDue(new Date("2026-09-21T06:00:00Z"));
    const alerts = await alertsFor(vehicle.id);
    expect(alerts).toHaveLength(2);
    expect(alerts.some((alert) => alert.severity === "CRITICAL")).toBe(true);
  });

  it("warns on distance driven, quoting the kilometres rather than a date", async () => {
    const vehicle = await carWithService({ nextServiceKm: 40_000 });

    await runMaintenanceDue(new Date("2026-04-01T06:00:00Z"));
    expect(await alertsFor(vehicle.id)).toHaveLength(0);

    // Driven to within 300 km of the marker.
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { currentMileageKm: 39_700 } });
    const result = await runMaintenanceDue(new Date("2026-04-02T06:00:00Z"));
    expect(result.notificationsCreated).toBeGreaterThan(0);

    const alerts = await alertsFor(vehicle.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.body).toContain("300 km");
  });

  it("says nothing about a car whose garage set no markers", async () => {
    const vehicle = await carWithService({});
    await runMaintenanceDue(new Date("2027-01-01T06:00:00Z"));
    expect(await alertsFor(vehicle.id)).toHaveLength(0);
  });
});
