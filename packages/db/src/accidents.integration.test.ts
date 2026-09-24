/**
 * Accidents and claims against a real database (P2-09, P2-10).
 *
 * The two rules worth the most here: a repair costs its month, not the month of the
 * crash, and an approved claim is not money. Both are ways of reporting a figure DrivenX
 * does not actually have, which is the failure this whole ledger design exists to avoid.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { IllegalAccidentTransitionError, IllegalClaimTransitionError, Money } from "@drivenx/core";

import {
  accidentCosts,
  accidentsForVehicle,
  AccidentRuleError,
  lodgeClaim,
  recordAccident,
  recordRepair,
  transitionAccident,
  transitionClaim,
  type NewAccident,
} from "./accidents";
import { activateContract, createContract } from "./contracts";
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
      make: "Mazda",
      model: "CX-5",
      year: 2025,
      plateEmirate: "DUBAI",
      plateCode: "K",
      plateNumber: String(61000 + serial),
      vin: `JM3CRASH${String(serial).padStart(9, "0")}`,
      currentMileageKm: 15_000,
      ownershipType: "COMPANY_OWNED",
    },
    null,
  );
}

const crash = (overrides: Partial<NewAccident> = {}): NewAccident => ({
  vehicleId,
  occurredOn: "2026-03-14",
  location: "Sheikh Zayed Road, exit 41",
  description: "Rear-ended at a standstill",
  policeReportNumber: `DP-${serial}-${Date.now() % 100000}`,
  ...overrides,
});

beforeEach(async () => {
  serial += 1;
  customerId = (
    await prisma.customer.create({
      data: { code: `CUS-A${Date.now()}${serial}`, fullName: "Mariam Saeed", mobile: "+971501234570" },
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

describe("logging a crash", () => {
  it("attaches it to whoever had the car that day, and costs nothing yet", async () => {
    const accident = await recordAccident(crash(), null);

    expect(accident).toMatchObject({
      contractId,
      customerId,
      status: "REPORTED",
      // Nobody knows whose fault it was on the day, and the record says so.
      responsibility: "UNKNOWN",
    });
    expect(await prisma.ledgerEntry.count({ where: { sourceId: accident.id } })).toBe(0);
  });

  it("refuses a crash with no location", async () => {
    await expect(recordAccident(crash({ location: "  " }), null)).rejects.toThrow(
      new AccidentRuleError("invalidAccident"),
    );
  });

  it("keeps a history from the moment it is logged", async () => {
    const accident = await recordAccident(crash(), null);
    const history = await prisma.accidentStatusChange.findMany({ where: { accidentId: accident.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: null, toStatus: "REPORTED" });
  });

  it("refuses a move the machine does not allow", async () => {
    const accident = await recordAccident(crash(), null);
    await transitionAccident(accident.id, { to: "CLOSED", actorId: null });
    await expect(
      transitionAccident(accident.id, { to: "UNDER_REPAIR", actorId: null }),
    ).rejects.toThrow(IllegalAccidentTransitionError);
  });
});

describe("the repair", () => {
  it("costs the month it was billed, not the month of the crash", async () => {
    const accident = await recordAccident(crash({ occurredOn: "2026-03-14" }), null);
    await recordRepair(accident.id, {
      repairNetFils: aed("4000"),
      vendor: "Al Futtaim Bodyshop",
      repairedOn: "2026-05-06",
    });

    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { sourceId: accident.id } });
    expect(entry).toMatchObject({ direction: "COST", category: "cost.repair", amountFils: aed("4000") });
    // March has already been reported on. The bill fell in May.
    expect(entry.occurredOn.toISOString().slice(0, 10)).toBe("2026-05-06");
    expect(entry.periodMonth).toBe(202605);
  });

  it("costs the net, because the garage's VAT is reclaimed", async () => {
    const accident = await recordAccident(crash(), null);
    const repaired = await recordRepair(accident.id, {
      repairNetFils: aed("4000"),
      vendor: "Al Futtaim Bodyshop",
      repairedOn: "2026-05-06",
    });

    expect(repaired).toMatchObject({
      repairNetFils: aed("4000"),
      repairVatFils: aed("200"),
      repairFils: aed("4200"),
    });
    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { sourceId: accident.id } });
    expect(entry.amountFils).toBe(aed("4000"));
  });

  it("refuses a second bill for the same crash", async () => {
    const accident = await recordAccident(crash(), null);
    const bill = { repairNetFils: aed("4000"), vendor: "Al Futtaim", repairedOn: "2026-05-06" } as const;
    await recordRepair(accident.id, bill);
    await expect(recordRepair(accident.id, bill)).rejects.toThrow(
      new AccidentRuleError("alreadyRepaired"),
    );
  });
});

describe("the claim", () => {
  async function repairedAccident() {
    const accident = await recordAccident(crash(), null);
    await recordRepair(accident.id, {
      repairNetFils: aed("4000"),
      vendor: "Al Futtaim Bodyshop",
      repairedOn: "2026-05-06",
    });
    return accident;
  }

  it("brings in nothing while the insurer is only thinking about it", async () => {
    const accident = await repairedAccident();
    const claim = await lodgeClaim(
      { accidentId: accident.id, claimNumber: `CLM-${Date.now()}`, lodgedOn: "2026-05-08", claimedFils: aed("4000") },
      null,
    );
    await transitionClaim(claim.id, { to: "APPROVED", approvedFils: aed("3500"), actorId: null });

    // Approved is not paid. Nothing has arrived, so nothing is recognised.
    expect(await prisma.ledgerEntry.count({ where: { sourceId: claim.id } })).toBe(0);
  });

  it("recognises only what actually arrives, on the day it arrives", async () => {
    const accident = await repairedAccident();
    const claim = await lodgeClaim(
      { accidentId: accident.id, claimNumber: `CLM-${Date.now()}`, lodgedOn: "2026-05-08", claimedFils: aed("4000") },
      null,
    );
    await transitionClaim(claim.id, { to: "APPROVED", approvedFils: aed("3500"), actorId: null });
    await transitionClaim(claim.id, {
      to: "SETTLED",
      receivedFils: aed("3500"),
      settledOn: "2026-06-20",
      actorId: null,
    });

    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { sourceId: claim.id } });
    expect(entry).toMatchObject({
      direction: "REVENUE",
      // Its own category: not revenue.insurance, which is the premium charged to a
      // customer and which §11 wants reportable on its own.
      category: "revenue.insurance_claim",
      amountFils: aed("3500"),
      vehicleId,
    });
    expect(entry.periodMonth).toBe(202606);
  });

  it("leaves the shortfall with DrivenX, which is what the excess is", async () => {
    const accident = await repairedAccident();
    const claim = await lodgeClaim(
      { accidentId: accident.id, claimNumber: `CLM-${Date.now()}`, lodgedOn: "2026-05-08", claimedFils: aed("4000") },
      null,
    );
    await transitionClaim(claim.id, { to: "APPROVED", approvedFils: aed("3500"), actorId: null });
    await transitionClaim(claim.id, {
      to: "SETTLED",
      receivedFils: aed("3500"),
      settledOn: "2026-06-20",
      actorId: null,
    });

    const [cost] = await accidentCosts(vehicleId);
    // 4,000 repaired, 3,500 recovered: the 500 excess is a real cost of running the car.
    expect(cost).toMatchObject({
      repairNetFils: aed("4000"),
      claimReceivedFils: aed("3500"),
      netCostFils: aed("500"),
    });
  });

  it("refuses to be settled without money and a date", async () => {
    const accident = await repairedAccident();
    const claim = await lodgeClaim(
      { accidentId: accident.id, claimNumber: `CLM-${Date.now()}`, lodgedOn: "2026-05-08", claimedFils: aed("4000") },
      null,
    );
    await transitionClaim(claim.id, { to: "APPROVED", approvedFils: aed("3500"), actorId: null });

    await expect(transitionClaim(claim.id, { to: "SETTLED", actorId: null })).rejects.toThrow(
      new AccidentRuleError("nothingReceived"),
    );
  });

  it("will not be settled before it is approved", async () => {
    const accident = await repairedAccident();
    const claim = await lodgeClaim(
      { accidentId: accident.id, claimNumber: `CLM-${Date.now()}`, lodgedOn: "2026-05-08", claimedFils: aed("4000") },
      null,
    );
    await expect(
      transitionClaim(claim.id, { to: "SETTLED", receivedFils: aed("3500"), settledOn: "2026-06-20", actorId: null }),
    ).rejects.toThrow(IllegalClaimTransitionError);
  });

  it("allows only one claim per crash", async () => {
    const accident = await repairedAccident();
    const claim = { accidentId: accident.id, claimNumber: `CLM-${Date.now()}`, lodgedOn: "2026-05-08" as const, claimedFils: aed("4000") };
    await lodgeClaim(claim, null);
    await expect(lodgeClaim({ ...claim, claimNumber: "CLM-OTHER" }, null)).rejects.toThrow(
      new AccidentRuleError("claimExists"),
    );
  });
});

describe("reaching the reports 1E already had (the Phase 2 exit test)", () => {
  it("moves vehicle profitability by the repair, and back by the recovery", async () => {
    const accident = await recordAccident(crash(), null);
    await recordRepair(accident.id, {
      repairNetFils: aed("4000"),
      vendor: "Al Futtaim Bodyshop",
      repairedOn: "2026-05-06",
    });

    const may = await profitReport("vehicle", 202605, 202605);
    const repaired = may.rows.find((row) => row.key === vehicleId);
    expect(repaired?.costFils).toBe(aed("4000"));
    // A repair is not a supplier's monthly bill, so it lands in the other-cost column.
    expect(repaired?.otherCostFils).toBe(aed("4000"));

    const claim = await lodgeClaim(
      { accidentId: accident.id, claimNumber: `CLM-${Date.now()}`, lodgedOn: "2026-05-08", claimedFils: aed("4000") },
      null,
    );
    await transitionClaim(claim.id, { to: "APPROVED", approvedFils: aed("3500"), actorId: null });
    await transitionClaim(claim.id, {
      to: "SETTLED",
      receivedFils: aed("3500"),
      settledOn: "2026-06-20",
      actorId: null,
    });

    const june = await profitReport("vehicle", 202606, 202606);
    const recovered = june.rows.find((row) => row.key === vehicleId);
    // The payout is revenue, but never the insurance revenue §11 asks to see on its own.
    expect(recovered?.otherRevenueFils).toBe(aed("3500"));
    expect(recovered?.insuranceFils).toBe(0n);
  });

  it("moves the month's profit by exactly the repair and by nothing else", async () => {
    const before = await monthResult("2026-05-01");
    const accident = await recordAccident(crash(), null);
    await recordRepair(accident.id, {
      repairNetFils: aed("4000"),
      vendor: "Al Futtaim Bodyshop",
      repairedOn: "2026-05-06",
    });
    const after = await monthResult("2026-05-01");

    expect(after.profitFils).toBe(before.profitFils - aed("4000"));
    expect(after.revenueFils).toBe(before.revenueFils);
  });
});

describe("what a car has been through", () => {
  it("lists its crashes with their claims", async () => {
    const accident = await recordAccident(crash(), null);
    await lodgeClaim(
      { accidentId: accident.id, claimNumber: "CLM-LIST", lodgedOn: "2026-03-20", claimedFils: aed("4000") },
      null,
    );

    const accidents = await accidentsForVehicle(vehicleId);
    expect(accidents).toHaveLength(1);
    expect(accidents[0]?.claim?.claimNumber).toBe("CLM-LIST");
  });
});
