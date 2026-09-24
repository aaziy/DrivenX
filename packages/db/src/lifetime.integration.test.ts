/**
 * Extended profitability and the lifetime view (P2-13, P2-14).
 *
 * Both read the same ledger as every other report, so the thing worth testing is that
 * they cannot disagree with it: the breakdown adds up to the headline figures, and a
 * car's life adds up to the sum of its months.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { Money } from "@drivenx/core";

import { recordAccident, recordRepair } from "./accidents";
import { activateContract, createContract, issueDueInstallments } from "./contracts";
import { recordExpense } from "./expenses";
import { recordFine, transitionFine } from "./fines";
import { createVehicle } from "./fleet";
import { prisma } from "./index";
import { recordMaintenance } from "./maintenance";
import { categoryTotals, profitReport, vehicleLifetime } from "./reports";

const aed = (value: string) => Money.parse(value);

let customerId: string;
let vehicleId: string;
let serial = 0;

async function car() {
  serial += 1;
  return createVehicle(
    {
      make: "Toyota",
      model: "Land Cruiser",
      year: 2025,
      plateEmirate: "DUBAI",
      plateCode: "P",
      plateNumber: String(81000 + serial),
      vin: `JTLIFE${String(serial).padStart(11, "0")}`,
      currentMileageKm: 1_000,
      ownershipType: "COMPANY_OWNED",
    },
    null,
  );
}

/** A car with a year of rent, a service, a fine, a crash and a cleaning bill. */
async function aBusyYear() {
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
  // Three months of rent issued, as the nightly job would have.
  await issueDueInstallments("2026-03-01");

  await recordMaintenance(
    {
      vehicleId,
      type: "SERVICE",
      servicedOn: "2026-02-10",
      odometerKm: 12_000,
      vendor: "Al Habtoor Motors",
      costNetFils: aed("800"),
    },
    null,
  );

  const fine = await recordFine(
    {
      vehicleId,
      fineNumber: `DXB-L-${serial}-${Date.now() % 100000}`,
      authority: "Dubai Police",
      occurredOn: "2026-02-14",
      amountFils: aed("600"),
    },
    null,
  );
  await transitionFine(fine.id, { to: "PAID", paidOn: "2026-02-20", actorId: null });

  const accident = await recordAccident(
    { vehicleId, occurredOn: "2026-03-02", location: "Al Khail Road" },
    null,
  );
  await recordRepair(accident.id, {
    repairNetFils: aed("4000"),
    vendor: "Al Futtaim Bodyshop",
    repairedOn: "2026-03-20",
  });

  await recordExpense(
    {
      category: "CLEANING",
      allocation: "VEHICLE",
      vehicleId,
      incurredOn: "2026-03-25",
      description: "Full valet",
      netFils: aed("100"),
    },
    null,
  );

  return draft.id;
}

beforeEach(async () => {
  serial += 1;
  customerId = (
    await prisma.customer.create({
      data: { code: `CUS-L${Date.now()}${serial}`, fullName: "Hassan Nouri", mobile: "+971501234572" },
    })
  ).id;
  vehicleId = (await car()).id;
});

describe("the breakdown by category (P2-13)", () => {
  it("names what the costs actually were, instead of one lump of other", async () => {
    await aBusyYear();

    const totals = await categoryTotals(202601, 202612, { vehicleId });
    const byCategory = new Map(totals.map((row) => [row.category, row.amountFils]));

    expect(byCategory.get("cost.maintenance")).toBe(aed("800"));
    expect(byCategory.get("cost.fine")).toBe(aed("600"));
    expect(byCategory.get("cost.repair")).toBe(aed("4000"));
    expect(byCategory.get("cost.cleaning")).toBe(aed("100"));
    expect(byCategory.get("revenue.rental")).toBe(aed("9000"));
  });

  it("adds up to exactly what the headline report says (INV-6)", async () => {
    await aBusyYear();

    const totals = await categoryTotals(202601, 202612, { vehicleId });
    const report = await profitReport("vehicle", 202601, 202612);
    const row = report.rows.find((entry) => entry.key === vehicleId);

    const side = (direction: "REVENUE" | "COST") =>
      totals
        .filter((entry) => entry.direction === direction)
        .reduce((sum, entry) => sum + entry.amountFils, 0n);

    // The breakdown is the same ledger grouped differently, so it cannot come to a
    // different number without one of them being wrong.
    expect(side("REVENUE")).toBe(row?.revenueFils);
    expect(side("COST")).toBe(row?.costFils);
  });

  it("puts revenue before cost, and the biggest first within each", async () => {
    await aBusyYear();
    const totals = await categoryTotals(202601, 202612, { vehicleId });

    const firstCost = totals.findIndex((row) => row.direction === "COST");
    expect(totals.slice(0, firstCost).every((row) => row.direction === "REVENUE")).toBe(true);

    const costs = totals.filter((row) => row.direction === "COST").map((row) => row.amountFils);
    expect([...costs].sort((a, b) => (b > a ? 1 : b < a ? -1 : 0))).toEqual(costs);
    // The repair was the biggest single cost of the year, so it leads.
    expect(totals.find((row) => row.direction === "COST")?.category).toBe("cost.repair");
  });

  it("leaves out what came to nothing", async () => {
    await aBusyYear();
    const totals = await categoryTotals(202601, 202612, { vehicleId });
    expect(totals.every((row) => row.amountFils !== 0n)).toBe(true);
  });
});

describe("a car's whole life (P2-14)", () => {
  it("adds up to what it earned less what it cost", async () => {
    await aBusyYear();
    const life = await vehicleLifetime(vehicleId);

    // Three months of rent against a service, a fine, a crash and a valet.
    expect(life.revenueFils).toBe(aed("9000"));
    expect(life.costFils).toBe(aed("5500"));
    expect(life.profitFils).toBe(aed("3500"));
  });

  it("agrees with the month-by-month report, because it is the same ledger", async () => {
    await aBusyYear();
    const life = await vehicleLifetime(vehicleId);
    const report = await profitReport("vehicle", 202601, 202612);
    const row = report.rows.find((entry) => entry.key === vehicleId);

    expect(life.revenueFils).toBe(row?.revenueFils);
    expect(life.costFils).toBe(row?.costFils);
    expect(life.profitFils).toBe(row?.profitFils);
  });

  it("says when the car started earning and when it last did anything", async () => {
    await aBusyYear();
    const life = await vehicleLifetime(vehicleId);

    expect(life.firstEntryOn?.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(life.lastEntryOn?.toISOString().slice(0, 10)).toBe("2026-03-25");
  });

  it("is quiet about a car that has never carried anything", async () => {
    const fresh = await car();
    const life = await vehicleLifetime(fresh.id);

    expect(life).toMatchObject({ revenueFils: 0n, costFils: 0n, profitFils: 0n, byCategory: [] });
    expect(life.firstEntryOn).toBeNull();
  });

  it("shows a loss as a loss rather than hiding it at zero", async () => {
    // A car that never earned: written off before it was ever let out.
    const accident = await recordAccident(
      { vehicleId, occurredOn: "2026-01-05", location: "The yard" },
      null,
    );
    await recordRepair(accident.id, {
      repairNetFils: aed("7000"),
      vendor: "Al Futtaim Bodyshop",
      repairedOn: "2026-01-20",
    });

    const life = await vehicleLifetime(vehicleId);
    expect(life.profitFils).toBe(-aed("7000"));
  });
});
