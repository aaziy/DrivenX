/**
 * Ending a contract, and its settlement (client 2026-09-20; P2-12).
 *
 * The rules that matter: arrears are never charged twice, the settlement becomes one
 * ordinary invoice so payments work as they always do, months that never fell due are
 * cancelled rather than silently billed, and the books still reconcile afterwards.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { IllegalVehicleTransitionError, Money } from "@drivenx/core";

import { activateContract, createContract, issueDueInstallments, recordPayment } from "./contracts";
import { createVehicle } from "./fleet";
import { prisma } from "./index";
import { reconcile } from "./reconcile";
import {
  addSettlementLine,
  openSettlement,
  removeSettlementLine,
  settlementTotals,
  settleSettlement,
  SettlementRuleError,
  terminateContract,
} from "./settlements";
import { raiseDueSupplierInvoices } from "./supplier-invoices";

const aed = (value: string) => Money.parse(value);

let customerId: string;
let supplierId: string;
let serial = 0;

async function car(ownershipType: "COMPANY_OWNED" | "B2B_SUPPLIER" = "COMPANY_OWNED") {
  serial += 1;
  return createVehicle(
    {
      make: "Mazda",
      model: "CX-5",
      year: 2025,
      plateEmirate: "DUBAI",
      plateCode: "T",
      plateNumber: String(21000 + serial),
      vin: `JM3SET${String(serial).padStart(11, "0")}`,
      currentMileageKm: 10_000,
      ownershipType,
      supplierId: ownershipType === "B2B_SUPPLIER" ? supplierId : null,
      supplierMonthlyCostFils: ownershipType === "B2B_SUPPLIER" ? aed("2000") : null,
    },
    null,
  );
}

async function liveContract(ownershipType: "COMPANY_OWNED" | "B2B_SUPPLIER" = "COMPANY_OWNED") {
  const vehicle = await car(ownershipType);
  const draft = await createContract(
    {
      customerId,
      vehicleId: vehicle.id,
      type: ownershipType === "B2B_SUPPLIER" ? "LEASE_TO_OWN" : "LONG_TERM_RENTAL",
      startDate: "2026-01-01",
      durationMonths: 12,
      monthlyRentalFils: aed("3000"),
    },
    null,
  );
  await activateContract(draft.id, { actorId: null, today: "2026-01-01" });
  return { contractId: draft.id, vehicleId: vehicle.id };
}

beforeEach(async () => {
  customerId = (
    await prisma.customer.create({ data: { code: `CUS-S${Date.now()}`, fullName: "Salem", mobile: "+971501234588" } })
  ).id;
  supplierId = (await prisma.supplier.create({ data: { code: `SUP-S${Date.now()}`, companyName: "Gulf Lease" } })).id;
});

describe("opening a settlement", () => {
  it("shows the arrears already owed without charging them again", async () => {
    const { contractId } = await liveContract();
    await issueDueInstallments("2026-03-01"); // three months invoiced at 3,150 gross
    await recordPayment(contractId, { amountFils: aed("3150"), receivedOn: "2026-01-05", method: "CASH" }, {
      actorId: null,
      today: "2026-03-01",
    });

    await openSettlement(contractId, { reason: "EARLY_TERMINATION", actorId: null });
    const totals = await settlementTotals(contractId);

    expect(totals.arrearsFils).toBe(aed("6300"));
    expect(totals.finalGrossFils).toBe(0n);
    expect(totals.totalDueFils).toBe(aed("6300"));
    // Nothing was invoiced by opening it.
    expect(await prisma.installment.count({ where: { contractId, invoiceNumber: { not: null } } })).toBe(3);
  });

  it("is refused twice over, on a contract that is not live, and with impossible mileage", async () => {
    const { contractId, vehicleId } = await liveContract();
    await openSettlement(contractId, { reason: "RETURN", actorId: null });
    await expect(openSettlement(contractId, { reason: "RETURN", actorId: null })).rejects.toMatchObject({
      code: "settlementExists",
    });

    const other = await liveContract();
    await expect(
      openSettlement(other.contractId, { reason: "RETURN", returnedMileageKm: 9_000, actorId: null }),
    ).rejects.toMatchObject({ code: "mileageBelowStart" });
    expect(vehicleId).toBeTruthy();
  });
});

describe("settling", () => {
  it("turns the lines into one final invoice, numbered and recognised today", async () => {
    const { contractId } = await liveContract();
    await issueDueInstallments("2026-02-01");
    const settlement = await openSettlement(contractId, {
      reason: "EARLY_TERMINATION",
      returnedMileageKm: 24_000,
      actorId: null,
    });

    await addSettlementLine(
      settlement.id,
      { kind: "CHARGE", chargeType: "EXCESS_MILEAGE", label: "4,000 km over", netFils: aed("2000") },
      null,
    );
    await addSettlementLine(
      settlement.id,
      { kind: "CHARGE", chargeType: "DAMAGE", label: "Kerbed alloy", netFils: aed("800") },
      null,
    );
    const goodwill = await addSettlementLine(
      settlement.id,
      { kind: "CREDIT", label: "Goodwill", netFils: aed("300") },
      null,
    );

    let totals = await settlementTotals(contractId);
    expect(totals.finalNetFils).toBe(aed("2500"));
    expect(totals.finalGrossFils).toBe(aed("2625"));

    // A line can be taken off again while the settlement is open.
    await removeSettlementLine(goodwill.id);
    totals = await settlementTotals(contractId);
    expect(totals.finalNetFils).toBe(aed("2800"));

    const revenueBefore = await prisma.ledgerEntry.aggregate({
      where: { contractId, direction: "REVENUE" },
      _sum: { amountFils: true },
    });
    const settled = await settleSettlement(settlement.id, { actorId: null, today: "2026-02-10" });
    expect(settled.status).toBe("SETTLED");

    const invoice = await prisma.installment.findUniqueOrThrow({ where: { id: settled.installmentId! } });
    expect(invoice).toMatchObject({ netFils: aed("2800"), grossFils: aed("2940"), status: "DUE" });
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{6}$/);

    // Revenue rose by the net of the settlement, and by nothing else.
    const revenueAfter = await prisma.ledgerEntry.aggregate({
      where: { contractId, direction: "REVENUE" },
      _sum: { amountFils: true },
    });
    expect((revenueAfter._sum.amountFils ?? 0n) - (revenueBefore._sum.amountFils ?? 0n)).toBe(aed("2800"));

    // And it is paid like any other instalment — oldest first, so clearing the settlement
    // means clearing the arrears in front of it. That is the whole point of reusing the
    // instalment machinery rather than inventing a second way to be owed money.
    const due = await settlementTotals(contractId);
    await recordPayment(contractId, { amountFils: due.totalDueFils, receivedOn: "2026-02-10", method: "CARD" }, {
      actorId: null,
      today: "2026-02-10",
    });
    expect((await prisma.installment.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("PAID");
    expect((await settlementTotals(contractId)).arrearsFils).toBe(0n);
    expect(await reconcile()).toEqual([]);
  });

  it("refuses credits worth more than the charges, and a settlement settled twice", async () => {
    const { contractId } = await liveContract();
    const settlement = await openSettlement(contractId, { reason: "RETURN", actorId: null });
    await addSettlementLine(settlement.id, { kind: "CHARGE", label: "Damage", netFils: aed("100") }, null);
    await addSettlementLine(settlement.id, { kind: "CREDIT", label: "Too generous", netFils: aed("500") }, null);

    await expect(settleSettlement(settlement.id, { actorId: null, today: "2026-02-10" })).rejects.toMatchObject({
      code: "creditsExceedCharges",
    });

    await removeSettlementLine((await prisma.settlementLine.findFirstOrThrow({ where: { kind: "CREDIT" } })).id);
    await settleSettlement(settlement.id, { actorId: null, today: "2026-02-10" });
    await expect(settleSettlement(settlement.id, { actorId: null, today: "2026-02-11" })).rejects.toMatchObject({
      code: "settlementClosed",
    });
    await expect(
      addSettlementLine(settlement.id, { kind: "CHARGE", label: "Late thought", netFils: aed("50") }, null),
    ).rejects.toMatchObject({ code: "settlementClosed" });
  });

  it("settles to nothing when there is nothing new to charge", async () => {
    const { contractId } = await liveContract();
    const settlement = await openSettlement(contractId, { reason: "END_OF_TERM", actorId: null });
    const settled = await settleSettlement(settlement.id, { actorId: null, today: "2026-02-10" });
    expect(settled.installmentId).toBeNull();
    // Only January's, issued when the contract was activated: the settlement added none.
    expect(await prisma.installment.count({ where: { contractId, invoiceNumber: { not: null } } })).toBe(1);
  });
});

describe("ending the contract", () => {
  it("releases the car, cancels the months that never fell due, and keeps the books straight", async () => {
    const { contractId, vehicleId } = await liveContract();
    await issueDueInstallments("2026-02-01");
    const settlement = await openSettlement(contractId, { reason: "EARLY_TERMINATION", actorId: null });
    await addSettlementLine(settlement.id, { kind: "CHARGE", label: "Damage", netFils: aed("500") }, null);
    await settleSettlement(settlement.id, { actorId: null, today: "2026-02-10" });

    const result = await terminateContract(contractId, {
      outcome: "EARLY_TERMINATION",
      vehicleTo: "RETURNED",
      actorId: null,
      today: "2026-02-10",
    });

    expect(result.status).toBe("CANCELLED");
    // Twelve rentals: two invoiced, ten never due.
    expect(result.cancelledInstallments).toBe(10);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).status).toBe("RETURNED");
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contractId } })).status).toBe("CANCELLED");
    expect(await reconcile()).toEqual([]);

    // The cancelled months are still on the schedule, marked.
    expect(await prisma.installment.count({ where: { contractId, status: "CANCELLED" } })).toBe(10);
  });

  it("stops the supplier's remaining months, and keeps the ones already raised", async () => {
    const { contractId } = await liveContract("B2B_SUPPLIER");
    await issueDueInstallments("2026-02-01");
    await raiseDueSupplierInvoices("2026-02-01");

    const result = await terminateContract(contractId, {
      outcome: "EARLY_TERMINATION",
      vehicleTo: "RETURNED",
      actorId: null,
      today: "2026-02-10",
    });

    expect(result.droppedPayables).toBe(10);
    const left = await prisma.supplierInvoice.findMany({ where: { contractId } });
    expect(left).toHaveLength(2);
    expect(left.every((invoice) => invoice.raisedOn !== null)).toBe(true);
    expect(await reconcile()).toEqual([]);
  });

  it("refuses to end while a settlement is open, or to sell a car that was only rented", async () => {
    const { contractId } = await liveContract();
    const settlement = await openSettlement(contractId, { reason: "RETURN", actorId: null });

    await expect(
      terminateContract(contractId, { outcome: "END_OF_TERM", vehicleTo: "RETURNED", actorId: null, today: "2026-02-10" }),
    ).rejects.toMatchObject({ code: "settlementNotSettled" });

    await settleSettlement(settlement.id, { actorId: null, today: "2026-02-10" });
    await expect(
      terminateContract(contractId, { outcome: "END_OF_TERM", vehicleTo: "SOLD", actorId: null, today: "2026-02-10" }),
    ).rejects.toBeInstanceOf(IllegalVehicleTransitionError);
  });

  it("is refused on a contract that already ended", async () => {
    const { contractId } = await liveContract();
    await terminateContract(contractId, {
      outcome: "END_OF_TERM",
      vehicleTo: "RETURNED",
      actorId: null,
      today: "2026-02-10",
    });
    await expect(
      terminateContract(contractId, { outcome: "END_OF_TERM", vehicleTo: "RETURNED", actorId: null, today: "2026-02-11" }),
    ).rejects.toBeInstanceOf(SettlementRuleError);
  });
});
