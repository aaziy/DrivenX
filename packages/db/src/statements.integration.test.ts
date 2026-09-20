/**
 * Statements of account against a real database (P1E-07, P1E-08).
 *
 * What a statement must never do: disagree with itself. The balance carried in plus the
 * lines in range is the closing balance, and a statement for any range closes on the
 * same figure as one for all time.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { businessDate, Money } from "@drivenx/core";

import { activateContract, createContract, issueDueInstallments, recordPayment, waiveInstallment } from "./contracts";
import { createVehicle } from "./fleet";
import { prisma } from "./index";
import { customerStatement, supplierStatement } from "./statements";
import { raiseDueSupplierInvoices, recordSupplierPayment } from "./supplier-invoices";

const aed = (value: string) => Money.parse(value);

let customerId: string;
let supplierId: string;
let serial = 0;

async function car(ownershipType: "COMPANY_OWNED" | "B2B_SUPPLIER") {
  serial += 1;
  return createVehicle(
    {
      make: "Honda",
      model: "Accord",
      year: 2025,
      plateEmirate: "DUBAI",
      plateCode: "H",
      plateNumber: String(60000 + serial),
      vin: `1HGSTM${String(serial).padStart(11, "0")}`,
      currentMileageKm: 0,
      ownershipType,
      supplierId: ownershipType === "B2B_SUPPLIER" ? supplierId : null,
      supplierMonthlyCostFils: ownershipType === "B2B_SUPPLIER" ? aed("2000") : null,
    },
    null,
  );
}

async function contract(ownershipType: "COMPANY_OWNED" | "B2B_SUPPLIER") {
  const vehicle = await car(ownershipType);
  const draft = await createContract(
    {
      customerId,
      vehicleId: vehicle.id,
      type: ownershipType === "B2B_SUPPLIER" ? "LEASE_TO_OWN" : "LONG_TERM_RENTAL",
      startDate: "2026-01-01",
      durationMonths: 6,
      monthlyRentalFils: aed("3000"),
    },
    null,
  );
  await activateContract(draft.id, { actorId: null, today: "2026-01-01" });
  return draft.id;
}

beforeEach(async () => {
  customerId = (
    await prisma.customer.create({ data: { code: `CUS-T${Date.now()}`, fullName: "Mariam", mobile: "+971501234571" } })
  ).id;
  supplierId = (await prisma.supplier.create({ data: { code: `SUP-T${Date.now()}`, companyName: "Gulf Lease" } })).id;
});

describe("customer statement", () => {
  it("lists invoices and payments in date order with a running balance", async () => {
    const id = await contract("COMPANY_OWNED");
    await issueDueInstallments("2026-03-01");
    await recordPayment(id, { amountFils: aed("3150"), receivedOn: "2026-01-05", method: "CASH", reference: "R-1" }, {
      actorId: null,
      today: "2026-03-01",
    });

    const statement = await customerStatement(customerId, "2026-01-01", "2026-03-31");
    expect(statement.lines.map((l) => [l.date, l.kind, l.debitFils, l.creditFils, l.balanceFils])).toEqual([
      ["2026-01-01", "invoice", aed("3150"), 0n, aed("3150")],
      ["2026-01-05", "payment", 0n, aed("3150"), 0n],
      ["2026-02-01", "invoice", aed("3150"), 0n, aed("3150")],
      ["2026-03-01", "invoice", aed("3150"), 0n, aed("6300")],
    ]);
    expect(statement.openingFils).toBe(0n);
    expect(statement.closingFils).toBe(aed("6300"));
  });

  it("carries earlier movements in as the opening balance, and closes as all-time does", async () => {
    const id = await contract("COMPANY_OWNED");
    await issueDueInstallments("2026-04-01");
    await recordPayment(id, { amountFils: aed("5000"), receivedOn: "2026-02-10", method: "BANK_TRANSFER" }, {
      actorId: null,
      today: "2026-04-01",
    });

    const whole = await customerStatement(customerId, "2000-01-01", "2026-04-30");
    const march = await customerStatement(customerId, "2026-03-01", "2026-04-30");

    // Jan + Feb invoiced (6,300) less 5,000 paid: 1,300 brought forward into March.
    expect(march.openingFils).toBe(aed("1300"));
    expect(march.lines).toHaveLength(2);
    expect(march.closingFils).toBe(whole.closingFils);
    expect(march.closingFils).toBe(aed("7600"));
  });

  it("credits a waived invoice back, and shows paying ahead as a balance in the customer's favour", async () => {
    const id = await contract("COMPANY_OWNED");
    await issueDueInstallments("2026-02-01");
    const feb = await prisma.installment.findFirstOrThrow({
      where: { contractId: id, dueDate: new Date("2026-02-01T00:00:00Z") },
    });
    await waiveInstallment(feb.id, { reason: "Goodwill", actorId: null, today: "2026-02-02" });
    await recordPayment(id, { amountFils: aed("5000"), receivedOn: "2026-02-03", method: "CASH" }, {
      actorId: null,
      today: "2026-02-03",
    });

    const statement = await customerStatement(customerId, "2026-01-01", businessDate(new Date()));
    const waiver = statement.lines.find((l) => l.kind === "waiver");
    expect(waiver?.creditFils).toBe(aed("3150"));
    // Invoiced 6,300, 3,150 of it waived, 5,000 paid: 1,850 in the customer's favour.
    expect(statement.closingFils).toBe(aed("-1850"));
  });
});

describe("supplier statement", () => {
  it("shows what the supplier billed as it fell due, against what was paid", async () => {
    await contract("B2B_SUPPLIER");
    await raiseDueSupplierInvoices("2026-02-01");
    const january = await prisma.supplierInvoice.findFirstOrThrow({ where: { supplierId, sequence: 1 } });
    // The supplier bills 2,000 net plus 5% VAT: 2,100 owed and paid.
    await recordSupplierPayment(january.id, { amountFils: aed("2100"), paidOn: "2026-01-10", method: "BANK_TRANSFER" }, {
      actorId: null,
      today: "2026-02-01",
    });

    const statement = await supplierStatement(supplierId, "2026-01-01", "2026-02-28");
    expect(statement.lines.map((l) => [l.date, l.kind, l.balanceFils])).toEqual([
      ["2026-01-01", "invoice", aed("2100")],
      ["2026-01-10", "payment", 0n],
      ["2026-02-01", "invoice", aed("2100")],
    ]);
    expect(statement.closingFils).toBe(aed("2100"));
  });
});
