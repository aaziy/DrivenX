/**
 * Dashboard figures against a real database (P1E-01, INV-6).
 *
 * The point of INV-6: the month's revenue, cost and profit on the dashboard are the ledger
 * summed for that month — including reversals — and nothing else.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { Money } from "@drivenx/core";

import { activateContract, createContract, issueDueInstallments, recordPayment, waiveInstallment } from "./contracts";
import { createVehicle } from "./fleet";
import { prisma } from "./index";
import { contractCounts, fleetCounts, monthResult, overdueInstallments, payables, receivables } from "./kpis";
import { raiseDueSupplierInvoices } from "./supplier-invoices";

const aed = (value: string) => Money.parse(value);

let customerId: string;
let supplierId: string;
let serial = 0;

async function car(ownershipType: "COMPANY_OWNED" | "B2B_SUPPLIER") {
  serial += 1;
  return createVehicle(
    {
      make: "Kia",
      model: "K5",
      year: 2025,
      plateEmirate: "DUBAI",
      plateCode: "K",
      plateNumber: String(40000 + serial),
      vin: `KNAKPI${String(serial).padStart(11, "0")}`,
      currentMileageKm: 0,
      ownershipType,
      supplierId: ownershipType === "B2B_SUPPLIER" ? supplierId : null,
      supplierMonthlyCostFils: ownershipType === "B2B_SUPPLIER" ? aed("2000") : null,
    },
    null,
  );
}

async function contractOn(vehicleId: string, type: "LONG_TERM_RENTAL" | "LEASE_TO_OWN") {
  const draft = await createContract(
    { customerId, vehicleId, type, startDate: "2026-01-01", durationMonths: 6, monthlyRentalFils: aed("3000") },
    null,
  );
  await activateContract(draft.id, { actorId: null, today: "2026-01-01" });
  return draft.id;
}

beforeEach(async () => {
  customerId = (
    await prisma.customer.create({ data: { code: `CUS-K${Date.now()}`, fullName: "Noura", mobile: "+971501234569" } })
  ).id;
  supplierId = (await prisma.supplier.create({ data: { code: `SUP-K${Date.now()}`, companyName: "Desert Fleet" } })).id;
});

describe("the month's result", () => {
  it("is the ledger for that month: rental in, the lease out, a waiver taken back (INV-6)", async () => {
    await contractOn((await car("COMPANY_OWNED")).id, "LONG_TERM_RENTAL");
    const leased = await contractOn((await car("B2B_SUPPLIER")).id, "LEASE_TO_OWN");
    await issueDueInstallments("2026-02-01");
    await raiseDueSupplierInvoices("2026-02-01");

    // February: two rentals issued, one lease month costed.
    let february = await monthResult("2026-02-15");
    expect(february).toEqual({
      periodMonth: 202602,
      revenueFils: aed("6000"),
      costFils: aed("2000"),
      profitFils: aed("4000"),
    });

    // Waiving February's rental on the leased car takes its revenue back in February.
    const feb = await prisma.installment.findFirstOrThrow({
      where: { contractId: leased, dueDate: new Date("2026-02-01T00:00:00Z") },
    });
    await waiveInstallment(feb.id, { reason: "Goodwill", actorId: null, today: "2026-02-10" });
    february = await monthResult("2026-02-15");
    expect(february.revenueFils).toBe(aed("3000"));
    expect(february.profitFils).toBe(aed("1000"));

    // And it is exactly the ledger, whatever else is on file.
    const ledger = await prisma.ledgerEntry.groupBy({
      by: ["direction"],
      where: { periodMonth: 202602 },
      _sum: { amountFils: true },
    });
    const sum = (d: string) => ledger.find((row) => row.direction === d)?._sum.amountFils ?? 0n;
    expect(february.revenueFils - february.costFils).toBe(sum("REVENUE") - sum("COST"));
  });

  it("is zero for a month with nothing in it", async () => {
    expect(await monthResult("2031-07-01")).toEqual({
      periodMonth: 203107,
      revenueFils: 0n,
      costFils: 0n,
      profitFils: 0n,
    });
  });
});

describe("balances", () => {
  it("count what is issued and unpaid, and what of it is late", async () => {
    const id = await contractOn((await car("COMPANY_OWNED")).id, "LONG_TERM_RENTAL");
    await issueDueInstallments("2026-02-01");
    // Two issued at AED 3,150 gross; 1,000 paid against January.
    await recordPayment(
      id,
      { amountFils: aed("1000"), receivedOn: "2026-02-01", method: "CASH" },
      { actorId: null, today: "2026-02-01" },
    );

    const owed = await receivables("2026-02-01");
    expect(owed.outstandingFils).toBe(aed("5300"));
    expect(owed.overdueFils).toBe(aed("2150"));
    expect(owed.overdueCount).toBe(1);

    const late = await overdueInstallments("2026-02-01");
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ customerName: "Noura", owedFils: aed("2150") });
  });

  it("owes the supplier only what has fallen due", async () => {
    await contractOn((await car("B2B_SUPPLIER")).id, "LEASE_TO_OWN");
    await raiseDueSupplierInvoices("2026-03-01");
    expect(await payables("2026-03-01")).toEqual({ outstandingFils: aed("6000"), overdueFils: aed("4000") });
  });
});

describe("counts", () => {
  it("split the fleet by ownership and by what the car is doing", async () => {
    await car("COMPANY_OWNED");
    await contractOn((await car("COMPANY_OWNED")).id, "LONG_TERM_RENTAL");
    await contractOn((await car("B2B_SUPPLIER")).id, "LEASE_TO_OWN");

    expect(await fleetCounts()).toEqual({ total: 3, owned: 2, leased: 1, available: 1, onContract: 2 });
    expect(await contractCounts("2026-01-01")).toEqual({ active: 2, overdue: 0, activeCustomers: 1 });
    // January unpaid a day later: both contracts are behind, whatever their stored status.
    expect((await contractCounts("2026-01-02")).overdue).toBe(2);
  });
});
