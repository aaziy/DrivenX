/**
 * Contracts against a real database (milestone 1D, slice 2a).
 *
 * The milestone's exit criterion is the first test: a 36-month contract with annual
 * insurance produces 36 rental and 3 insurance instalments, and the ledger reconciles to
 * the contract's total to the fil. The rest prove what the code claims about atomicity,
 * numbering and the ledger's append-only rule — none of which a unit test can reach.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { IllegalVehicleTransitionError, Money } from "@drivenx/core";

import {
  activateContract,
  ContractRuleError,
  createContract,
  issueDueInstallments,
  recordPayment,
  refreshOverdue,
  waiveInstallment,
  type NewContract,
} from "./contracts";
import { createVehicle } from "./fleet";
import { prisma } from "./index";

const aed = (value: string) => Money.parse(value);

let customerId: string;
let supplierId: string;
let serial = 0;

async function car(ownershipType: "COMPANY_OWNED" | "B2B_SUPPLIER" = "COMPANY_OWNED") {
  serial += 1;
  return createVehicle(
    {
      make: "Toyota",
      model: "Camry",
      year: 2024,
      plateEmirate: "DUBAI",
      plateCode: "C",
      plateNumber: String(20000 + serial),
      vin: `JTDCON${String(serial).padStart(11, "0")}`,
      currentMileageKm: 0,
      ownershipType,
      supplierId: ownershipType === "B2B_SUPPLIER" ? supplierId : null,
      supplierMonthlyCostFils: ownershipType === "B2B_SUPPLIER" ? aed("2400") : null,
    },
    null,
  );
}

function contract(vehicleId: string, overrides: Partial<NewContract> = {}): NewContract {
  return {
    customerId,
    vehicleId,
    type: "LONG_TERM_RENTAL",
    startDate: "2026-01-01",
    durationMonths: 36,
    monthlyRentalFils: aed("3400"),
    ...overrides,
  };
}

async function revenue(contractId: string) {
  const rows = await prisma.ledgerEntry.findMany({ where: { contractId, direction: "REVENUE" } });
  return rows.reduce((sum, row) => sum + row.amountFils, 0n);
}

beforeEach(async () => {
  customerId = (
    await prisma.customer.create({ data: { code: `CUS-C${Date.now()}`, fullName: "Ahmed", mobile: "+971501234567" } })
  ).id;
  supplierId = (await prisma.supplier.create({ data: { code: `SUP-C${Date.now()}`, companyName: "Gulf Motors" } })).id;
});

describe("the milestone's exit criterion", () => {
  it("36 months with annual insurance: 36 + 3 instalments, and the ledger reconciles to the fil", async () => {
    const vehicle = await car();
    const draft = await createContract(contract(vehicle.id, { annualInsuranceFils: aed("2500") }), null);

    const result = await activateContract(draft.id, { actorId: null, today: "2026-01-01" });
    expect(result.installments).toBe(39);

    const byType = await prisma.installment.groupBy({
      by: ["chargeId"],
      where: { contractId: draft.id },
      _count: true,
    });
    const counts = await Promise.all(
      byType.map(async (group) => ({
        type: (await prisma.contractCharge.findUniqueOrThrow({ where: { id: group.chargeId } })).chargeType,
        count: group._count,
      })),
    );
    expect(counts).toEqual(
      expect.arrayContaining([
        { type: "MONTHLY_RENTAL", count: 36 },
        { type: "ANNUAL_INSURANCE", count: 3 },
      ]),
    );

    // Every instalment falls due by the last day; issue them all.
    await issueDueInstallments("2028-12-31");

    const installments = await prisma.installment.findMany({ where: { contractId: draft.id } });
    const scheduledNet = installments.reduce((sum, item) => sum + item.netFils, 0n);

    // 3,400 × 36 + 2,500 × 3, and the ledger holds exactly that as revenue (INV-1, INV-4).
    expect(scheduledNet).toBe(aed("129900"));
    expect(await revenue(draft.id)).toBe(scheduledNet);
    expect(installments.every((item) => item.invoiceNumber !== null)).toBe(true);
  });
});

describe("activation", () => {
  it("issues only what is due today, and books only that revenue", async () => {
    const vehicle = await car();
    const draft = await createContract(
      contract(vehicle.id, { annualInsuranceFils: aed("2500"), downPaymentFils: aed("5000") }),
      null,
    );

    const result = await activateContract(draft.id, { actorId: null, today: "2026-01-01" });

    // Down payment, first rental and first insurance year are due on the first day.
    expect(result.issued).toBe(3);
    expect(await revenue(draft.id)).toBe(aed("5000") + aed("3400") + aed("2500"));

    const upcoming = await prisma.installment.count({
      where: { contractId: draft.id, invoiceNumber: null, status: "UPCOMING" },
    });
    expect(upcoming).toBe(40 - 3);
  });

  it("puts the car on the contract and records why", async () => {
    const vehicle = await car();
    const draft = await createContract(contract(vehicle.id), null);

    await activateContract(draft.id, { actorId: null, today: "2026-01-01" });

    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).status).toBe("RENTED");
    const latest = await prisma.vehicleStatusChange.findFirstOrThrow({
      where: { vehicleId: vehicle.id },
      orderBy: { changedAt: "desc" },
    });
    expect(latest).toMatchObject({ fromStatus: "AVAILABLE", toStatus: "RENTED", reason: draft.number });
  });

  it("moves a lease-to-own car to Lease-to-own, not Rented", async () => {
    const vehicle = await car("B2B_SUPPLIER");
    const draft = await createContract(
      contract(vehicle.id, { type: "LEASE_TO_OWN", buyoutFils: aed("1000") }),
      null,
    );

    await activateContract(draft.id, { actorId: null, today: "2026-01-01" });

    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).status).toBe("LEASE_TO_OWN");
  });

  it("refuses a sold car and writes nothing at all", async () => {
    const vehicle = await car();
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { status: "SOLD" } });
    const draft = await createContract(contract(vehicle.id), null);

    await expect(activateContract(draft.id, { actorId: null, today: "2026-01-01" })).rejects.toThrow(
      IllegalVehicleTransitionError,
    );

    // All-or-nothing: no charges, no schedule, no ledger, still a draft.
    expect(await prisma.contractCharge.count({ where: { contractId: draft.id } })).toBe(0);
    expect(await prisma.installment.count({ where: { contractId: draft.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { contractId: draft.id } })).toBe(0);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");
  });

  it("refuses a second contract on a car that is already out", async () => {
    const vehicle = await car();
    const first = await createContract(contract(vehicle.id), null);
    const second = await createContract(contract(vehicle.id), null);

    await activateContract(first.id, { actorId: null, today: "2026-01-01" });

    // The car is now Rented, and Rented → Rented is not a move.
    await expect(activateContract(second.id, { actorId: null, today: "2026-01-01" })).rejects.toThrow(
      IllegalVehicleTransitionError,
    );
  });

  it("lets the database refuse two live contracts on one car, whatever the code does (INV-9)", async () => {
    const vehicle = await car();
    const first = await createContract(contract(vehicle.id), null);
    const second = await createContract(contract(vehicle.id), null);
    await activateContract(first.id, { actorId: null, today: "2026-01-01" });

    // Written directly, bypassing every check in the service.
    await expect(
      prisma.contract.update({ where: { id: second.id }, data: { status: "ACTIVE" } }),
    ).rejects.toThrow();
  });

  it("will not activate a contract twice", async () => {
    const vehicle = await car();
    const draft = await createContract(contract(vehicle.id), null);
    await activateContract(draft.id, { actorId: null, today: "2026-01-01" });

    await expect(activateContract(draft.id, { actorId: null, today: "2026-01-01" })).rejects.toMatchObject({
      name: "IllegalContractTransitionError",
    });
  });
});

describe("writing a contract", () => {
  it("refuses a plain rental on a car leased from a supplier", async () => {
    const vehicle = await car("B2B_SUPPLIER");
    await expect(createContract(contract(vehicle.id), null)).rejects.toMatchObject({
      code: "leasedCarNotLeaseToOwn",
    });
  });

  it("refuses a blacklisted customer", async () => {
    const vehicle = await car();
    await prisma.customer.update({ where: { id: customerId }, data: { status: "BLACKLISTED" } });
    await expect(createContract(contract(vehicle.id), null)).rejects.toBeInstanceOf(ContractRuleError);
  });

  it("refuses a buyout on anything but lease-to-own", async () => {
    const vehicle = await car();
    await expect(
      createContract(contract(vehicle.id, { buyoutFils: aed("1000") }), null),
    ).rejects.toMatchObject({ code: "buyoutOnlyOnLeaseToOwn" });
  });
});

describe("invoice numbering", () => {
  it("is sequential and gapless across contracts issued at the same time", async () => {
    const vehicles = await Promise.all([car(), car(), car()]);
    const drafts = await Promise.all(vehicles.map((v) => createContract(contract(v.id, { durationMonths: 6 }), null)));

    await Promise.all(drafts.map((d) => activateContract(d.id, { actorId: null, today: "2026-01-01" })));
    await issueDueInstallments("2026-06-30");

    const numbers = (await prisma.installment.findMany({ where: { invoiceNumber: { not: null } } }))
      .map((item) => Number(item.invoiceNumber!.replace("INV-", "")))
      .sort((a, b) => a - b);

    expect(numbers).toHaveLength(18);
    // No gaps, no duplicates: exactly first..first+17.
    expect(numbers).toEqual(Array.from({ length: 18 }, (_, i) => numbers[0]! + i));
  });
});

describe("the ledger", () => {
  it("posts each instalment once, however many times the job runs", async () => {
    const vehicle = await car();
    const draft = await createContract(contract(vehicle.id, { durationMonths: 3 }), null);
    await activateContract(draft.id, { actorId: null, today: "2026-01-01" });

    await issueDueInstallments("2026-03-31");
    const once = await prisma.ledgerEntry.count({ where: { contractId: draft.id } });
    await issueDueInstallments("2026-03-31");
    await issueDueInstallments("2026-03-31");

    expect(once).toBe(3);
    expect(await prisma.ledgerEntry.count({ where: { contractId: draft.id } })).toBe(3);
  });

  it("puts revenue in the month it was earned", async () => {
    const vehicle = await car();
    const draft = await createContract(contract(vehicle.id, { durationMonths: 3 }), null);
    await activateContract(draft.id, { actorId: null, today: "2026-01-01" });
    await issueDueInstallments("2026-03-31");

    const periods = (await prisma.ledgerEntry.findMany({ where: { contractId: draft.id }, orderBy: { periodMonth: "asc" } }))
      .map((row) => row.periodMonth);
    expect(periods).toEqual([202601, 202602, 202603]);
  });

  it("refuses to be edited or deleted, even directly (INV-7)", async () => {
    const vehicle = await car();
    const draft = await createContract(contract(vehicle.id, { durationMonths: 1 }), null);
    await activateContract(draft.id, { actorId: null, today: "2026-01-01" });
    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { contractId: draft.id } });

    await expect(
      prisma.ledgerEntry.update({ where: { id: entry.id }, data: { amountFils: 1n } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.ledgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
  });
});

describe("payments", () => {
  /** A three-month rental, activated on its first day: 3 × 3,570 gross is owed. */
  async function live() {
    const vehicle = await car();
    const draft = await createContract(contract(vehicle.id, { durationMonths: 3 }), null);
    await activateContract(draft.id, { actorId: null, today: "2026-01-01" });
    const installments = await prisma.installment.findMany({
      where: { contractId: draft.id },
      orderBy: { dueDate: "asc" },
    });
    return { id: draft.id, installments };
  }

  const pay = (contractId: string, amount: string, receivedOn = "2026-01-01", today = "2026-01-01") =>
    recordPayment(contractId, { amountFils: aed(amount), receivedOn, method: "BANK_TRANSFER" }, { actorId: null, today });

  it("part-pays the instalment that is due", async () => {
    const { id, installments } = await live();
    await pay(id, "2000");

    const first = await prisma.installment.findUniqueOrThrow({ where: { id: installments[0]!.id } });
    expect(first.paidFils).toBe(aed("2000"));
    expect(first.status).toBe("PARTIALLY_PAID");
  });

  it("pays ahead, and keeps anything beyond the whole balance as credit", async () => {
    const { id } = await live();
    const result = await pay(id, "12000");

    // 3 × 3,570 = 10,710 owed; 1,290 over.
    expect(result.creditFils).toBe(aed("1290"));
    const statuses = (await prisma.installment.findMany({ where: { contractId: id } })).map((i) => i.status);
    expect(statuses).toEqual(["PAID", "PAID", "PAID"]);
  });

  it("refuses a payment dated in the future, and accepts one dated in the past", async () => {
    const { id } = await live();
    await expect(pay(id, "100", "2026-01-02", "2026-01-01")).rejects.toMatchObject({ code: "paymentInFuture" });
    // A cheque received last week is recorded today.
    await expect(pay(id, "100", "2025-12-28", "2026-01-01")).resolves.toBeDefined();
  });

  it("refuses a payment against a contract that is not live", async () => {
    const vehicle = await car();
    const draft = await createContract(contract(vehicle.id), null);
    await expect(pay(draft.id, "100")).rejects.toMatchObject({ code: "contractNotLive" });
  });
});

describe("overdue", () => {
  it("marks an unpaid instalment and its contract overdue, and clears both when paid", async () => {
    const vehicle = await car();
    const draft = await createContract(contract(vehicle.id, { durationMonths: 3 }), null);
    await activateContract(draft.id, { actorId: null, today: "2026-01-01" });

    await refreshOverdue("2026-01-02");
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("OVERDUE");

    await recordPayment(
      draft.id,
      { amountFils: aed("3570"), receivedOn: "2026-01-02", method: "CASH" },
      { actorId: null, today: "2026-01-02" },
    );

    expect((await prisma.contract.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("ACTIVE");
    const first = await prisma.installment.findFirstOrThrow({ where: { contractId: draft.id }, orderBy: { dueDate: "asc" } });
    expect(first.status).toBe("PAID");
  });
});

describe("waivers", () => {
  async function issuedFirst() {
    const vehicle = await car();
    const draft = await createContract(contract(vehicle.id, { durationMonths: 3 }), null);
    await activateContract(draft.id, { actorId: null, today: "2026-01-01" });
    const first = await prisma.installment.findFirstOrThrow({ where: { contractId: draft.id }, orderBy: { dueDate: "asc" } });
    return { contractId: draft.id, first };
  }

  it("needs a reason", async () => {
    const { first } = await issuedFirst();
    await expect(waiveInstallment(first.id, { reason: "   ", actorId: null, today: "2026-01-01" })).rejects.toMatchObject({
      code: "waiveNeedsReason",
    });
  });

  it("takes back revenue already booked, with a reversing entry — the original stays", async () => {
    const { contractId, first } = await issuedFirst();
    expect(await revenue(contractId)).toBe(aed("3400"));

    await waiveInstallment(first.id, { reason: "Goodwill after breakdown", actorId: null, today: "2026-01-05" });

    expect(await revenue(contractId)).toBe(0n);
    const entries = await prisma.ledgerEntry.findMany({ where: { contractId }, orderBy: { createdAt: "asc" } });
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ amountFils: -aed("3400"), reversesId: entries[0]!.id });
  });

  it("refuses to waive an instalment that has been part-paid", async () => {
    const { contractId, first } = await issuedFirst();
    await recordPayment(
      contractId,
      { amountFils: aed("500"), receivedOn: "2026-01-01", method: "CASH" },
      { actorId: null, today: "2026-01-01" },
    );
    await expect(
      waiveInstallment(first.id, { reason: "Goodwill", actorId: null, today: "2026-01-01" }),
    ).rejects.toMatchObject({ code: "waivePaidInstallment" });
  });
});
