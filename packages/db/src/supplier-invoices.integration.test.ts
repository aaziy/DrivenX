/**
 * Supplier payables for leased-in cars (P1D-13), against a real database.
 *
 * What matters: the lease is costed month by month as it falls due, never all at once and
 * never on payment; paying the supplier moves cash only; and the books still reconcile.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { Money } from "@drivenx/core";

import { activateContract, ContractRuleError, createContract } from "./contracts";
import { createVehicle } from "./fleet";
import { prisma } from "./index";
import { reconcile } from "./reconcile";
import {
  raiseDueSupplierInvoices,
  recordSupplierPayment,
  refreshSupplierOverdue,
  type SupplierInvoiceRuleError,
} from "./supplier-invoices";

const aed = (value: string) => Money.parse(value);

let customerId: string;
let supplierId: string;
let serial = 0;

async function leasedCar(monthlyCost: bigint | null = aed("2400")) {
  serial += 1;
  return createVehicle(
    {
      make: "Nissan",
      model: "Patrol",
      year: 2025,
      plateEmirate: "DUBAI",
      plateCode: "S",
      plateNumber: String(30000 + serial),
      vin: `JN1SUP${String(serial).padStart(11, "0")}`,
      currentMileageKm: 0,
      ownershipType: "B2B_SUPPLIER",
      supplierId,
      supplierMonthlyCostFils: monthlyCost,
    },
    null,
  );
}

async function leaseToOwn(vehicleId: string, today = "2026-01-01") {
  const draft = await createContract(
    {
      customerId,
      vehicleId,
      type: "LEASE_TO_OWN",
      startDate: "2026-01-01",
      durationMonths: 12,
      monthlyRentalFils: aed("3400"),
      buyoutFils: aed("1000"),
    },
    null,
  );
  const result = await activateContract(draft.id, { actorId: null, today });
  return { id: draft.id, result };
}

async function supplierCost(contractId: string) {
  const rows = await prisma.ledgerEntry.findMany({ where: { contractId, category: "cost.supplier" } });
  return { total: rows.reduce((sum, row) => sum + row.amountFils, 0n), rows };
}

beforeEach(async () => {
  customerId = (
    await prisma.customer.create({ data: { code: `CUS-S${Date.now()}`, fullName: "Fatima", mobile: "+971501234568" } })
  ).id;
  supplierId = (await prisma.supplier.create({ data: { code: `SUP-S${Date.now()}`, companyName: "Emirates Leasing" } }))
    .id;
});

describe("activating lease-to-own on a leased-in car", () => {
  it("writes one supplier invoice per month and costs only the first", async () => {
    const vehicle = await leasedCar();
    const { id, result } = await leaseToOwn(vehicle.id);

    expect(result.supplierInvoices).toBe(12);
    expect(result.supplierRaised).toBe(1);

    const invoices = await prisma.supplierInvoice.findMany({ where: { contractId: id }, orderBy: { sequence: "asc" } });
    expect(invoices).toHaveLength(12);
    expect(invoices.every((invoice) => invoice.amountFils === aed("2400") && invoice.supplierId === supplierId)).toBe(true);
    expect(invoices[0]?.status).toBe("DUE");
    expect(invoices[1]?.status).toBe("UPCOMING");

    const cost = await supplierCost(id);
    expect(cost.total).toBe(aed("2400"));
    expect(cost.rows[0]).toMatchObject({ direction: "COST", periodMonth: 202601, vehicleId: vehicle.id, supplierId });
  });

  it("writes nothing for a car the company owns", async () => {
    serial += 1;
    const owned = await createVehicle(
      {
        make: "Toyota",
        model: "Camry",
        year: 2024,
        plateEmirate: "DUBAI",
        plateCode: "S",
        plateNumber: String(30000 + serial),
        vin: `JTDOWN${String(serial).padStart(11, "0")}`,
        currentMileageKm: 0,
        ownershipType: "COMPANY_OWNED",
      },
      null,
    );
    const { id, result } = await leaseToOwn(owned.id);
    expect(result.supplierInvoices).toBe(0);
    expect(await prisma.supplierInvoice.count({ where: { contractId: id } })).toBe(0);
  });

  it("refuses when the agreed monthly cost is missing, and writes nothing", async () => {
    const vehicle = await leasedCar(null);
    const draft = await createContract(
      {
        customerId,
        vehicleId: vehicle.id,
        type: "LEASE_TO_OWN",
        startDate: "2026-01-01",
        durationMonths: 12,
        monthlyRentalFils: aed("3400"),
      },
      null,
    );

    const refusal = await activateContract(draft.id, { actorId: null, today: "2026-01-01" }).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(ContractRuleError);
    expect((refusal as ContractRuleError).code).toBe("supplierCostMissing");

    expect(await prisma.installment.count({ where: { contractId: draft.id } })).toBe(0);
    expect(await prisma.supplierInvoice.count({ where: { contractId: draft.id } })).toBe(0);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");
  });
});

describe("the nightly run", () => {
  it("costs each month as it falls due, in its own month, however often it runs", async () => {
    const vehicle = await leasedCar();
    const { id } = await leaseToOwn(vehicle.id);

    await raiseDueSupplierInvoices("2026-03-15");
    await raiseDueSupplierInvoices("2026-03-15");

    const cost = await supplierCost(id);
    expect(cost.rows.map((row) => row.periodMonth).sort()).toEqual([202601, 202602, 202603]);
    expect(cost.total).toBe(aed("7200"));
  });

  it("marks raised, unpaid invoices overdue once past due", async () => {
    const vehicle = await leasedCar();
    const { id } = await leaseToOwn(vehicle.id);

    await raiseDueSupplierInvoices("2026-01-02");
    await refreshSupplierOverdue("2026-01-02");

    const first = await prisma.supplierInvoice.findFirstOrThrow({ where: { contractId: id, sequence: 1 } });
    const second = await prisma.supplierInvoice.findFirstOrThrow({ where: { contractId: id, sequence: 2 } });
    expect(first.status).toBe("OVERDUE");
    expect(second.status).toBe("UPCOMING");
  });
});

describe("paying the supplier", () => {
  it("settles the invoice and never touches the ledger", async () => {
    const vehicle = await leasedCar();
    const { id } = await leaseToOwn(vehicle.id);
    const first = await prisma.supplierInvoice.findFirstOrThrow({ where: { contractId: id, sequence: 1 } });
    const ledgerBefore = await prisma.ledgerEntry.count();

    await recordSupplierPayment(
      first.id,
      { amountFils: aed("1000"), paidOn: "2026-01-01", method: "BANK_TRANSFER" },
      { actorId: null, today: "2026-01-01" },
    );
    let invoice = await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: first.id } });
    expect(invoice.status).toBe("PARTIALLY_PAID");

    await recordSupplierPayment(
      first.id,
      { amountFils: aed("1400"), paidOn: "2026-01-01", method: "CHEQUE", reference: "CHQ 0042" },
      { actorId: null, today: "2026-01-01" },
    );
    invoice = await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: first.id } });
    expect(invoice.status).toBe("PAID");
    expect(invoice.paidFils).toBe(aed("2400"));

    expect(await prisma.ledgerEntry.count()).toBe(ledgerBefore);
  });

  it("refuses paying more than the invoice, nothing at all, or a date in the future", async () => {
    const vehicle = await leasedCar();
    const { id } = await leaseToOwn(vehicle.id);
    const first = await prisma.supplierInvoice.findFirstOrThrow({ where: { contractId: id, sequence: 1 } });
    const pay = (amount: string, paidOn = "2026-01-01") =>
      recordSupplierPayment(
        first.id,
        { amountFils: aed(amount), paidOn, method: "CASH" },
        { actorId: null, today: "2026-01-01" },
      ).catch((e: unknown) => (e as SupplierInvoiceRuleError).code);

    expect(await pay("2400.01")).toBe("overpayment");
    expect(await pay("0")).toBe("invalidPayment");
    expect(await pay("100", "2026-01-02")).toBe("paymentInFuture");
    expect(await prisma.supplierPayment.count({ where: { supplierInvoiceId: first.id } })).toBe(0);
  });

  it("can pay a month ahead", async () => {
    const vehicle = await leasedCar();
    const { id } = await leaseToOwn(vehicle.id);
    const second = await prisma.supplierInvoice.findFirstOrThrow({ where: { contractId: id, sequence: 2 } });

    await recordSupplierPayment(
      second.id,
      { amountFils: aed("2400"), paidOn: "2026-01-01", method: "BANK_TRANSFER" },
      { actorId: null, today: "2026-01-01" },
    );
    const invoice = await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: second.id } });
    expect(invoice.status).toBe("PAID");
    expect(invoice.raisedOn).toBeNull();
  });
});

describe("the books", () => {
  it("reconcile with supplier invoices raised and part-paid (INV-11, INV-12)", async () => {
    const vehicle = await leasedCar();
    const { id } = await leaseToOwn(vehicle.id);
    await raiseDueSupplierInvoices("2026-02-01");
    const first = await prisma.supplierInvoice.findFirstOrThrow({ where: { contractId: id, sequence: 1 } });
    await recordSupplierPayment(
      first.id,
      { amountFils: aed("500"), paidOn: "2026-01-20", method: "CASH" },
      { actorId: null, today: "2026-02-01" },
    );

    expect(await reconcile()).toEqual([]);
  });
});
