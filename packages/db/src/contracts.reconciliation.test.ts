/**
 * Reconciliation (IMPLEMENTATION_PLAN §2.3): the financial invariants over a realistic mix
 * of contracts, and proof that the checker notices when they break.
 *
 * The second half matters as much as the first. A checker that reports nothing for a
 * healthy database proves nothing on its own — it might report nothing for anything. Each
 * test there corrupts one thing the way a bug would, and requires it to be caught.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { Money } from "@drivenx/core";

import {
  activateContract,
  createContract,
  issueDueInstallments,
  recordPayment,
  refreshOverdue,
  waiveInstallment,
} from "./contracts";
import { createVehicle } from "./fleet";
import { prisma } from "./index";
import { reconcile } from "./reconcile";

const aed = (value: string) => Money.parse(value);

let serial = 0;
let customerId: string;
let supplierId: string;

async function car(ownershipType: "COMPANY_OWNED" | "B2B_SUPPLIER" = "COMPANY_OWNED") {
  serial += 1;
  return createVehicle(
    {
      make: "Nissan",
      model: "Patrol",
      year: 2024,
      plateEmirate: "DUBAI",
      plateCode: "R",
      plateNumber: String(30000 + serial),
      vin: `JN8REC${String(serial).padStart(11, "0")}`,
      currentMileageKm: 0,
      ownershipType,
      supplierId: ownershipType === "B2B_SUPPLIER" ? supplierId : null,
      supplierMonthlyCostFils: ownershipType === "B2B_SUPPLIER" ? aed("2300") : null,
    },
    null,
  );
}

/**
 * Three contracts of different shapes, activated, run forward five months with part
 * payments, an over-payment, a waiver and the overdue pass — the ordinary life of a book.
 */
async function aBookOfContracts() {
  const rental = await createContract(
    {
      customerId,
      vehicleId: (await car()).id,
      type: "LONG_TERM_RENTAL",
      startDate: "2026-01-01",
      durationMonths: 36,
      monthlyRentalFils: aed("3400"),
      annualInsuranceFils: aed("2500"),
      downPaymentFils: aed("5000"),
    },
    null,
  );
  const leaseToOwn = await createContract(
    {
      customerId,
      vehicleId: (await car("B2B_SUPPLIER")).id,
      type: "LEASE_TO_OWN",
      startDate: "2026-01-31",
      durationMonths: 30,
      monthlyRentalFils: aed("3500"),
      annualInsuranceFils: aed("2500"),
      buyoutFils: aed("1000"),
    },
    null,
  );
  const short = await createContract(
    {
      customerId,
      vehicleId: (await car()).id,
      type: "B2B_RENTAL",
      startDate: "2026-02-15",
      durationMonths: 3,
      monthlyRentalFils: aed("2999.99"),
    },
    null,
  );

  await activateContract(rental.id, { actorId: null, today: "2026-01-01" });
  await activateContract(leaseToOwn.id, { actorId: null, today: "2026-01-31" });
  await activateContract(short.id, { actorId: null, today: "2026-02-15" });

  await issueDueInstallments("2026-05-31");
  await refreshOverdue("2026-05-31");

  const pay = (contractId: string, amount: string) =>
    recordPayment(
      contractId,
      { amountFils: aed(amount), receivedOn: "2026-05-31", method: "BANK_TRANSFER" },
      { actorId: null, today: "2026-05-31" },
    );
  await pay(rental.id, "9999.99");
  await pay(leaseToOwn.id, "40000");
  await pay(short.id, "15000");

  const waivable = await prisma.installment.findFirstOrThrow({
    where: { contractId: rental.id, paidFils: 0n, invoiceNumber: { not: null } },
  });
  await waiveInstallment(waivable.id, { reason: "Goodwill", actorId: null, today: "2026-05-31" });

  return { rental, leaseToOwn, short };
}

beforeEach(async () => {
  customerId = (
    await prisma.customer.create({ data: { code: `CUS-R${Date.now()}`, fullName: "Reconcile", mobile: "+971501234567" } })
  ).id;
  supplierId = (await prisma.supplier.create({ data: { code: `SUP-R${Date.now()}`, companyName: "Recon Motors" } })).id;
});

describe("a healthy book", () => {
  it("satisfies every invariant (INV-1, 2, 3, 4, 9, 10)", async () => {
    await aBookOfContracts();
    expect(await reconcile()).toEqual([]);
  });
});

describe("the checker catches a broken book", () => {
  it("notices an instalment whose paid amount no allocation explains (INV-3)", async () => {
    await aBookOfContracts();
    const unpaid = await prisma.installment.findFirstOrThrow({ where: { paidFils: 0n, waivedAt: null } });
    await prisma.installment.update({ where: { id: unpaid.id }, data: { paidFils: 1n } });

    expect((await reconcile()).map((v) => v.invariant)).toContain("INV-3");
  });

  it("notices revenue on the ledger that no instalment earned (INV-4)", async () => {
    const { short } = await aBookOfContracts();
    await prisma.ledgerEntry.create({
      data: {
        occurredOn: new Date("2026-05-31T00:00:00Z"),
        periodMonth: 202605,
        direction: "REVENUE",
        category: "revenue.rental",
        amountFils: 100n,
        contractId: short.id,
        sourceType: "Stray",
        sourceId: "stray",
      },
    });

    expect((await reconcile()).map((v) => v.invariant)).toContain("INV-4");
  });

  it("notices a car sitting available while its contract is live (INV-9)", async () => {
    const { rental } = await aBookOfContracts();
    await prisma.vehicle.update({ where: { id: rental.vehicleId }, data: { status: "AVAILABLE" } });

    expect((await reconcile()).map((v) => v.invariant)).toContain("INV-9");
  });
});
