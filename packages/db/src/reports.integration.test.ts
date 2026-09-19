/**
 * Profitability reports against a real database (P1E-05, P1E-06, INV-6).
 *
 * The property that matters: every view of the same months adds up to the same ledger
 * total, insurance is reported apart from rental, and a supplier's lease is cost against
 * the car and the contract it was paid for.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { Money } from "@drivenx/core";

import { activateContract, createContract, issueDueInstallments } from "./contracts";
import { createVehicle } from "./fleet";
import { prisma } from "./index";
import { profitReport, REPORT_DIMENSIONS } from "./reports";
import { raiseDueSupplierInvoices } from "./supplier-invoices";

const aed = (value: string) => Money.parse(value);

let customerId: string;
let supplierId: string;
let serial = 0;

async function car(ownershipType: "COMPANY_OWNED" | "B2B_SUPPLIER") {
  serial += 1;
  return createVehicle(
    {
      make: "Mazda",
      model: "6",
      year: 2025,
      plateEmirate: "DUBAI",
      plateCode: "M",
      plateNumber: String(50000 + serial),
      vin: `JM1RPT${String(serial).padStart(11, "0")}`,
      currentMileageKm: 0,
      ownershipType,
      supplierId: ownershipType === "B2B_SUPPLIER" ? supplierId : null,
      supplierMonthlyCostFils: ownershipType === "B2B_SUPPLIER" ? aed("2000") : null,
    },
    null,
  );
}

beforeEach(async () => {
  customerId = (
    await prisma.customer.create({ data: { code: `CUS-R${Date.now()}`, fullName: "Hessa", mobile: "+971501234570" } })
  ).id;
  supplierId = (await prisma.supplier.create({ data: { code: `SUP-R${Date.now()}`, companyName: "Oasis Leasing" } })).id;
});

async function book() {
  const owned = await car("COMPANY_OWNED");
  const leased = await car("B2B_SUPPLIER");

  // An owned car on rental with annual insurance; a leased car on lease-to-own.
  const rental = await createContract(
    {
      customerId,
      vehicleId: owned.id,
      type: "LONG_TERM_RENTAL",
      startDate: "2026-01-01",
      durationMonths: 12,
      monthlyRentalFils: aed("3000"),
      annualInsuranceFils: aed("2400"),
    },
    null,
  );
  await activateContract(rental.id, { actorId: null, today: "2026-01-01" });
  const lto = await createContract(
    {
      customerId,
      vehicleId: leased.id,
      type: "LEASE_TO_OWN",
      startDate: "2026-01-01",
      durationMonths: 12,
      monthlyRentalFils: aed("3500"),
    },
    null,
  );
  await activateContract(lto.id, { actorId: null, today: "2026-01-01" });
  await issueDueInstallments("2026-02-15");
  await raiseDueSupplierInvoices("2026-02-15");
  return { owned, leased, rental, lto };
}

describe("profitability", () => {
  it("adds up to the ledger in every view (INV-6)", async () => {
    await book();
    const reports = await Promise.all(REPORT_DIMENSIONS.map((d) => profitReport(d, 202601, 202602)));

    // Jan–Feb: rental 2×3,000 + 2×3,500 = 13,000; insurance 2,400 (annual, January);
    // supplier lease 2×2,000 = 4,000.
    for (const report of reports) {
      expect(report.total).toMatchObject({
        rentalFils: aed("13000"),
        insuranceFils: aed("2400"),
        revenueFils: aed("15400"),
        supplierCostFils: aed("4000"),
        costFils: aed("4000"),
        profitFils: aed("11400"),
      });
      const rowsProfit = report.rows.reduce((sum, row) => sum + row.profitFils, 0n);
      expect(rowsProfit).toBe(report.total.profitFils);
    }
  });

  it("puts the lease against the leased car, and insurance apart from rental", async () => {
    const { owned, leased } = await book();
    const report = await profitReport("vehicle", 202601, 202612);

    const ownedRow = report.rows.find((row) => row.key === owned.id);
    const leasedRow = report.rows.find((row) => row.key === leased.id);
    expect(ownedRow).toMatchObject({ rentalFils: aed("6000"), insuranceFils: aed("2400"), costFils: 0n });
    expect(leasedRow).toMatchObject({ rentalFils: aed("7000"), supplierCostFils: aed("4000"), profitFils: aed("3000") });
    expect(leasedRow?.href).toBe(`/vehicles/${leased.id}`);
  });

  it("gives entries with no supplier their own row rather than dropping them", async () => {
    await book();
    const report = await profitReport("supplier", 202601, 202612);

    const withSupplier = report.rows.find((row) => row.key === supplierId);
    const unassigned = report.rows.find((row) => row.key === null);
    expect(withSupplier?.profitFils).toBe(aed("3000"));
    expect(unassigned?.revenueFils).toBe(aed("8400"));
    expect(report.rows.at(-1)?.key).toBeNull();
  });

  it("runs months in order and reports nothing outside the range", async () => {
    await book();
    const months = await profitReport("month", 202601, 202612);
    expect(months.rows.map((row) => row.key)).toEqual(["202601", "202602"]);

    const march = await profitReport("month", 202603, 202603);
    expect(march.rows).toEqual([]);
    expect(march.total.profitFils).toBe(0n);
  });
});

describe("filters (P1E-04)", () => {
  it("narrow to one contract type, and to one salesperson's sales", async () => {
    const { rental, lto } = await book();
    const sellerId = (
      await prisma.user.create({ data: { email: `seller.${Date.now()}@x.ae`, fullName: "Seller", passwordHash: "x" } })
    ).id;
    await prisma.contract.update({ where: { id: lto.id }, data: { salespersonId: sellerId } });

    const ltoOnly = await profitReport("contract", 202601, 202602, { contractType: "LEASE_TO_OWN" });
    expect(ltoOnly.rows.map((row) => row.key)).toEqual([lto.id]);
    // 2 × 3,500 rental less 2 × 2,000 lease.
    expect(ltoOnly.total.profitFils).toBe(aed("3000"));

    const theirs = await profitReport("month", 202601, 202602, { salespersonId: sellerId });
    expect(theirs.total.revenueFils).toBe(aed("7000"));

    const rentals = await profitReport("contract", 202601, 202602, { contractType: "LONG_TERM_RENTAL" });
    expect(rentals.rows.map((row) => row.key)).toEqual([rental.id]);

    // Unfiltered, nothing is lost.
    const all = await profitReport("contract", 202601, 202602);
    expect(all.total.profitFils).toBe(ltoOnly.total.profitFils + rentals.total.profitFils);
  });
});
