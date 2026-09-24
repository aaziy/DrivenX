/**
 * Expenses against a real database (P2-11).
 *
 * The rule worth the most: an overhead belongs to no car. A cost filed against a vehicle
 * is invisible once it is in the ledger, and every per-vehicle figure from then on is
 * quietly wrong — so the allocation is enforced, not merely offered.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { Money } from "@drivenx/core";

import { activateContract, createContract } from "./contracts";
import { expenseTotals, ExpenseRuleError, listExpenses, recordExpense, type NewExpense } from "./expenses";
import { createVehicle } from "./fleet";
import { prisma } from "./index";
import { monthResult } from "./kpis";
import { profitReport } from "./reports";

const aed = (value: string) => Money.parse(value);

let customerId: string;
let vehicleId: string;
let contractId: string;
let serial = 0;

async function car() {
  serial += 1;
  return createVehicle(
    {
      make: "Honda",
      model: "Civic",
      year: 2025,
      plateEmirate: "DUBAI",
      plateCode: "L",
      plateNumber: String(71000 + serial),
      vin: `JHMEXP${String(serial).padStart(11, "0")}`,
      currentMileageKm: 5_000,
      ownershipType: "COMPANY_OWNED",
    },
    null,
  );
}

const expense = (overrides: Partial<NewExpense> = {}): NewExpense => ({
  category: "CLEANING",
  allocation: "VEHICLE",
  vehicleId,
  incurredOn: "2026-07-09",
  description: "Full valet",
  netFils: aed("100"),
  ...overrides,
});

beforeEach(async () => {
  serial += 1;
  customerId = (
    await prisma.customer.create({
      data: { code: `CUS-E${Date.now()}${serial}`, fullName: "Noura Ali", mobile: "+971501234571" },
    })
  ).id;
  vehicleId = (await car()).id;
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
  contractId = draft.id;
});

describe("recording a cost", () => {
  it("posts the net against the car, on the day it was incurred", async () => {
    const recorded = await recordExpense(expense(), null);

    expect(recorded).toMatchObject({ netFils: aed("100"), vatFils: aed("5"), grossFils: aed("105") });

    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { sourceId: recorded.id } });
    expect(entry).toMatchObject({
      direction: "COST",
      category: "cost.cleaning",
      amountFils: aed("100"),
      vehicleId,
      contractId: null,
    });
    expect(entry.occurredOn.toISOString().slice(0, 10)).toBe("2026-07-09");
  });

  it("assumes no VAT on a government charge, because there is none to reclaim", async () => {
    const registration = await recordExpense(
      expense({ category: "REGISTRATION", description: "Mulkiya renewal", netFils: aed("420") }),
      null,
    );
    expect(registration).toMatchObject({ vatBasisPoints: 0, vatFils: 0n, grossFils: aed("420") });

    const toll = await recordExpense(
      expense({ category: "TOLL", description: "Salik top-up", netFils: aed("50") }),
      null,
    );
    expect(toll.vatFils).toBe(0n);
  });

  it("lets staff say otherwise, because a private car park does charge VAT", async () => {
    const parking = await recordExpense(
      expense({ category: "PARKING", description: "Mall car park", netFils: aed("40"), vatBasisPoints: 500 }),
      null,
    );
    expect(parking.vatFils).toBe(aed("2"));
  });

  it("takes a contract's car and customer from the contract itself", async () => {
    const recorded = await recordExpense(
      expense({ allocation: "CONTRACT", contractId, vehicleId: null, category: "RECOVERY" }),
      null,
    );

    expect(recorded).toMatchObject({ contractId, vehicleId, customerId });
    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { sourceId: recorded.id } });
    expect(entry).toMatchObject({ contractId, vehicleId, customerId });
  });

  it("refuses a car-charged cost with no car, and a contract-charged one with no contract", async () => {
    await expect(recordExpense(expense({ vehicleId: null }), null)).rejects.toThrow(
      new ExpenseRuleError("vehicleRequired"),
    );
    await expect(
      recordExpense(expense({ allocation: "CONTRACT", contractId: null, vehicleId: null }), null),
    ).rejects.toThrow(new ExpenseRuleError("contractRequired"));
  });

  it("refuses a cost with nothing written on it", async () => {
    await expect(recordExpense(expense({ description: "   " }), null)).rejects.toThrow(
      new ExpenseRuleError("invalidExpense"),
    );
  });
});

describe("an overhead belongs to no car", () => {
  it("carries no dimensions at all", async () => {
    const recorded = await recordExpense(
      {
        category: "OVERHEAD",
        allocation: "COMPANY",
        incurredOn: "2026-07-01",
        description: "Office rent",
        netFils: aed("12000"),
      },
      null,
    );

    expect(recorded).toMatchObject({ vehicleId: null, contractId: null, customerId: null });
    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { sourceId: recorded.id } });
    expect(entry).toMatchObject({ vehicleId: null, contractId: null, customerId: null });
  });

  it("counts against the month without touching any car's profitability", async () => {
    const before = await profitReport("vehicle", 202607, 202607);
    const carBefore = before.rows.find((row) => row.key === vehicleId)?.costFils ?? 0n;

    await recordExpense(
      {
        category: "OVERHEAD",
        allocation: "COMPANY",
        incurredOn: "2026-07-01",
        description: "Office rent",
        netFils: aed("12000"),
      },
      null,
    );

    const after = await profitReport("vehicle", 202607, 202607);
    // The car is exactly where it was: office rent is not this car's cost.
    expect(after.rows.find((row) => row.key === vehicleId)?.costFils ?? 0n).toBe(carBefore);
    // But the month is down by it.
    expect(after.total.costFils).toBe(before.total.costFils + aed("12000"));
  });

  it("is refused outright if it names a car", async () => {
    // The database has the last word: an overhead filed against a car would be invisible
    // once posted, and every per-vehicle figure after it would be wrong.
    await expect(
      prisma.expense.create({
        data: {
          category: "OVERHEAD",
          allocation: "COMPANY",
          vehicleId,
          incurredOn: new Date("2026-07-01T00:00:00Z"),
          description: "Office rent filed against a car",
          netFils: aed("12000"),
          vatBasisPoints: 500,
          vatFils: aed("600"),
          grossFils: aed("12600"),
        },
      }),
    ).rejects.toThrow();
  });
});

describe("reaching the reports 1E already had", () => {
  it("moves the month's profit by exactly the net", async () => {
    const before = await monthResult("2026-07-01");
    await recordExpense(expense({ netFils: aed("100") }), null);
    const after = await monthResult("2026-07-01");

    // The net, not the 105 paid: the 5 of VAT is reclaimed and was never a cost.
    expect(after.profitFils).toBe(before.profitFils - aed("100"));
  });

  it("lands in the other-cost column, not among supplier costs", async () => {
    await recordExpense(expense({ netFils: aed("100") }), null);
    const report = await profitReport("vehicle", 202607, 202607);
    const row = report.rows.find((entry) => entry.key === vehicleId);

    expect(row?.otherCostFils).toBe(aed("100"));
    expect(row?.supplierCostFils).toBe(0n);
  });
});

describe("what has been spent", () => {
  it("lists and totals by kind, biggest first", async () => {
    await recordExpense(expense({ category: "CLEANING", netFils: aed("100") }), null);
    await recordExpense(expense({ category: "FUEL", description: "Diesel", netFils: aed("300") }), null);

    const listed = await listExpenses({ vehicleId });
    expect(listed).toHaveLength(2);

    const totals = await expenseTotals({ vehicleId });
    expect(totals[0]).toEqual({ category: "FUEL", netFils: aed("300") });
    expect(totals[1]).toEqual({ category: "CLEANING", netFils: aed("100") });
  });

  it("narrows to a period", async () => {
    await recordExpense(expense({ incurredOn: "2026-07-09" }), null);
    await recordExpense(expense({ incurredOn: "2026-08-09", description: "Later valet" }), null);

    const july = await listExpenses({ vehicleId, from: "2026-07-01", to: "2026-07-31" });
    expect(july).toHaveLength(1);
    expect(july[0]?.description).toBe("Full valet");
  });
});
