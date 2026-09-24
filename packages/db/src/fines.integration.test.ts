/**
 * Fines against a real database (P2-07, P2-08).
 *
 * The rule under test throughout: the ledger follows the money, not the blame. Declaring
 * a customer liable moves nothing; DrivenX paying the authority is a cost; invoicing the
 * customer is revenue. Getting that wrong reports profit nobody has collected.
 *
 * Phase 2's exit test applies here too — a fine must reach vehicle profitability through
 * the reporting layer 1E already had, with no changes to it.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { IllegalFineTransitionError, Money } from "@drivenx/core";

import { activateContract, createContract, issueDueInstallments } from "./contracts";
import {
  FineRuleError,
  finesForVehicle,
  outstandingFines,
  recordFine,
  recoverFine,
  setFinePayer,
  transitionFine,
  type NewFine,
} from "./fines";
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
      make: "Toyota",
      model: "Corolla",
      year: 2025,
      plateEmirate: "DUBAI",
      plateCode: "F",
      plateNumber: String(51000 + serial),
      vin: `JTDFINE${String(serial).padStart(10, "0")}`,
      currentMileageKm: 10_000,
      ownershipType: "COMPANY_OWNED",
    },
    null,
  );
}

async function liveContract(vehicle: string) {
  const draft = await createContract(
    {
      customerId,
      vehicleId: vehicle,
      type: "LONG_TERM_RENTAL",
      startDate: "2026-01-01",
      durationMonths: 12,
      monthlyRentalFils: aed("3000"),
    },
    null,
  );
  await activateContract(draft.id, { actorId: null, today: "2026-01-01" });
  return draft.id;
}

const notice = (overrides: Partial<NewFine> = {}): NewFine => ({
  vehicleId,
  fineNumber: `DXB-${serial}-${Date.now() % 100000}`,
  authority: "Dubai Police",
  occurredOn: "2026-03-14",
  issuedOn: "2026-03-28",
  amountFils: aed("600"),
  ...overrides,
});

beforeEach(async () => {
  serial += 1;
  customerId = (
    await prisma.customer.create({
      data: { code: `CUS-F${Date.now()}${serial}`, fullName: "Yousef Khalil", mobile: "+971501234599" },
    })
  ).id;
  vehicleId = (await car()).id;
  contractId = await liveContract(vehicleId);
});

describe("recording a notice", () => {
  it("attaches it to whoever had the car on the day of the offence, not today", async () => {
    const fine = await recordFine(notice(), null);

    expect(fine).toMatchObject({ contractId, customerId, payer: "CUSTOMER", status: "OPEN" });
    // Nothing has moved yet.
    expect(await prisma.ledgerEntry.count({ where: { sourceId: fine.id } })).toBe(0);
  });

  it("falls to the company when the car was in the yard that day", async () => {
    // Before the contract began: the car was nobody's but DrivenX's.
    const fine = await recordFine(notice({ occurredOn: "2025-11-02" }), null);

    expect(fine.contractId).toBeNull();
    expect(fine.customerId).toBeNull();
    expect(fine.payer).toBe("COMPANY");
  });

  it("lets staff override who it falls to", async () => {
    const fine = await recordFine(notice(), null);
    const moved = await setFinePayer(fine.id, "COMPANY");
    expect(moved.payer).toBe("COMPANY");
  });

  it("refuses the same notice twice", async () => {
    const first = notice();
    await recordFine(first, null);
    await expect(recordFine(first, null)).rejects.toThrow(new FineRuleError("duplicateFine"));
  });

  it("takes the same number from a different authority", async () => {
    const first = notice();
    await recordFine(first, null);
    await expect(recordFine({ ...first, authority: "Abu Dhabi Police" }, null)).resolves.toBeTruthy();
  });

  it("refuses a fine of nothing", async () => {
    await expect(recordFine(notice({ amountFils: 0n }), null)).rejects.toThrow(new FineRuleError("invalidFine"));
  });

  it("keeps a history from the moment it is recorded", async () => {
    const fine = await recordFine(notice(), null);
    const history = await prisma.fineStatusChange.findMany({ where: { fineId: fine.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: null, toStatus: "OPEN" });
  });
});

describe("what reaches the ledger", () => {
  it("costs nothing while the fine is merely blamed on someone", async () => {
    const fine = await recordFine(notice(), null);
    await transitionFine(fine.id, { to: "DISPUTED", actorId: null });

    expect(await prisma.ledgerEntry.count({ where: { sourceId: fine.id } })).toBe(0);
  });

  it("never touches the books when the customer settles it with the authority", async () => {
    const fine = await recordFine(notice(), null);
    await transitionFine(fine.id, { to: "PAID_BY_CUSTOMER", actorId: null });

    // DrivenX's money never moved, so DrivenX's books have nothing to say about it.
    expect(await prisma.ledgerEntry.count({ where: { sourceId: fine.id } })).toBe(0);
  });

  it("costs the whole penalty on the day DrivenX pays, with no VAT held back", async () => {
    const fine = await recordFine(notice(), null);
    await transitionFine(fine.id, { to: "PAID", paidOn: "2026-04-02", actorId: null });

    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { sourceId: fine.id } });
    expect(entry).toMatchObject({
      direction: "COST",
      category: "cost.fine",
      // The full 600, not 600 less a 5% that nobody charged and nobody can reclaim.
      amountFils: aed("600"),
      vehicleId,
      contractId,
      customerId,
    });
    expect(entry.occurredOn.toISOString().slice(0, 10)).toBe("2026-04-02");
  });

  it("refuses to be paid without saying when", async () => {
    const fine = await recordFine(notice(), null);
    await expect(transitionFine(fine.id, { to: "PAID", actorId: null })).rejects.toThrow(
      new FineRuleError("invalidFine"),
    );
  });

  it("refuses a move the machine does not allow", async () => {
    const fine = await recordFine(notice(), null);
    await transitionFine(fine.id, { to: "CANCELLED", actorId: null });
    await expect(
      transitionFine(fine.id, { to: "PAID", paidOn: "2026-04-02", actorId: null }),
    ).rejects.toThrow(IllegalFineTransitionError);
  });

  it("keeps the cost when DrivenX decides to absorb it", async () => {
    const fine = await recordFine(notice(), null);
    await transitionFine(fine.id, { to: "PAID", paidOn: "2026-04-02", actorId: null });
    await transitionFine(fine.id, { to: "WAIVED", reason: "Goodwill", actorId: null });

    // The money left. Choosing not to chase it does not bring it back.
    const entries = await prisma.ledgerEntry.findMany({ where: { sourceId: fine.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ direction: "COST", amountFils: aed("600") });

    const waived = await prisma.fine.findUniqueOrThrow({ where: { id: fine.id } });
    expect(waived.paidOn).not.toBeNull();
  });
});

describe("recharging the customer (P2-08)", () => {
  async function paidFine() {
    const fine = await recordFine(notice(), null);
    return transitionFine(fine.id, { to: "PAID", paidOn: "2026-04-02", actorId: null });
  }

  it("raises one ordinary invoice, numbered like every other", async () => {
    const fine = await paidFine();
    const recovered = await recoverFine(fine.id, { actorId: null, today: "2026-04-05" });

    expect(recovered.status).toBe("RECOVERED");
    expect(recovered.recoveryInstallmentId).not.toBeNull();

    const installment = await prisma.installment.findUniqueOrThrow({
      where: { id: recovered.recoveryInstallmentId as string },
      include: { charge: true },
    });
    expect(installment.invoiceNumber).toMatch(/^INV-\d{6}$/);
    expect(installment.charge.chargeType).toBe("FINE_RECOVERY");
    // A disbursement rather than a supply: recharged at cost, with no VAT on top.
    expect(installment).toMatchObject({ netFils: aed("600"), vatFils: 0n, grossFils: aed("600") });
  });

  it("recognises it as fine recovery, not as rent", async () => {
    const fine = await paidFine();
    await recoverFine(fine.id, { actorId: null, today: "2026-04-05" });

    const revenue = await prisma.ledgerEntry.findFirstOrThrow({
      where: { contractId, category: "revenue.fine_recovery" },
    });
    expect(revenue).toMatchObject({ direction: "REVENUE", amountFils: aed("600"), vehicleId, customerId });
  });

  it("nets out against the cost, so recovering a fine leaves profit where it was", async () => {
    // April's rent is issued first, as the nightly job does on the day it falls due.
    // Recovering a fine issues whatever else is due along with it — the same behaviour
    // settling a contract has — so without this the month would also gain a month's rent
    // and the comparison would be measuring the wrong thing.
    await issueDueInstallments("2026-04-05");
    const before = await monthResult("2026-04-01");
    const fine = await paidFine();
    const afterCost = await monthResult("2026-04-01");
    await recoverFine(fine.id, { actorId: null, today: "2026-04-05" });
    const afterRecovery = await monthResult("2026-04-01");

    // Paying it is a loss of exactly the fine.
    expect(afterCost.profitFils).toBe(before.profitFils - aed("600"));
    // Recharging it brings the month back to where it started, to the fils.
    expect(afterRecovery.profitFils).toBe(before.profitFils);
  });

  it("reaches vehicle profitability through the report 1E already had", async () => {
    await issueDueInstallments("2026-04-05");
    const fine = await paidFine();
    const report = await profitReport("vehicle", 202604, 202604);
    const row = report.rows.find((entry) => entry.key === vehicleId);
    expect(row?.costFils).toBe(aed("600"));

    await recoverFine(fine.id, { actorId: null, today: "2026-04-05" });
    const after = await profitReport("vehicle", 202604, 202604);
    const recovered = after.rows.find((entry) => entry.key === vehicleId);
    // The recovery lands as revenue against the same car, through the same report.
    expect(recovered?.revenueFils).toBe((row?.revenueFils ?? 0n) + aed("600"));
    // And the fine's own effect on the car's profit is exactly nil.
    expect(recovered?.profitFils).toBe((row?.profitFils ?? 0n) + aed("600"));
  });

  it("refuses to recharge one that was never paid", async () => {
    const fine = await recordFine(notice(), null);
    await expect(recoverFine(fine.id, { actorId: null, today: "2026-04-05" })).rejects.toThrow(
      IllegalFineTransitionError,
    );
  });

  it("refuses to recharge one with nobody to recharge", async () => {
    const fine = await recordFine(notice({ occurredOn: "2025-11-02" }), null);
    await transitionFine(fine.id, { to: "PAID", paidOn: "2026-04-02", actorId: null });

    await expect(recoverFine(fine.id, { actorId: null, today: "2026-04-05" })).rejects.toThrow(
      new FineRuleError("noCustomerToRecharge"),
    );
  });

  it("refuses to recharge the same fine twice", async () => {
    const fine = await paidFine();
    await recoverFine(fine.id, { actorId: null, today: "2026-04-05" });
    await expect(recoverFine(fine.id, { actorId: null, today: "2026-04-06" })).rejects.toThrow();
  });
});

describe("what operations still has to chase", () => {
  it("lists what is unresolved and drops what is finished", async () => {
    const open = await recordFine(notice(), null);
    const settled = await recordFine(notice({ fineNumber: `DXB-S-${Date.now()}` }), null);
    await transitionFine(settled.id, { to: "PAID_BY_CUSTOMER", actorId: null });

    const outstanding = await outstandingFines();
    const ids = outstanding.map((fine) => fine.id);
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(settled.id);
  });

  it("shows a car everything it has collected", async () => {
    await recordFine(notice(), null);
    const fines = await finesForVehicle(vehicleId);
    expect(fines).toHaveLength(1);
    expect(fines[0]?.authority).toBe("Dubai Police");
  });
});
