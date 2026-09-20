/**
 * Insurance policies against a real database (P1D-10 – P1D-12).
 *
 * What matters: the premium is costed net, because its VAT is reclaimed; the cost lands
 * in the month cover starts, beside the insurance the customer is charged; and a refund
 * is a reversal, never an edit of a month already reported.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { Money } from "@drivenx/core";

import { activateContract, createContract, issueDueInstallments } from "./contracts";
import { createVehicle } from "./fleet";
import { prisma } from "./index";
import { cancelPolicy, createPolicy, currentPolicy, InsuranceRuleError, policiesDueForRenewal, policyState } from "./insurance";
import { monthResult } from "./kpis";
import { profitReport } from "./reports";

const aed = (value: string) => Money.parse(value);

let vehicleId: string;
let customerId: string;
let serial = 0;

beforeEach(async () => {
  serial += 1;
  customerId = (
    await prisma.customer.create({ data: { code: `CUS-I${Date.now()}`, fullName: "Yousef", mobile: "+971501234599" } })
  ).id;
  vehicleId = (
    await createVehicle(
      {
        make: "Toyota",
        model: "Corolla",
        year: 2025,
        plateEmirate: "DUBAI",
        plateCode: "I",
        plateNumber: String(90000 + serial),
        vin: `JTDINS${String(Date.now()).slice(-11)}`,
        currentMileageKm: 0,
        ownershipType: "COMPANY_OWNED",
      },
      null,
    )
  ).id;
});

const policy = (overrides: Partial<Parameters<typeof createPolicy>[0]> = {}) => ({
  vehicleId,
  provider: "Oman Insurance",
  policyNumber: `POL-${Date.now()}-${serial}`,
  coverage: "COMPREHENSIVE" as const,
  startDate: "2026-01-01",
  expiryDate: "2026-12-31",
  premiumNetFils: aed("2000"),
  ...overrides,
});

async function insuranceCost(vehicle: string) {
  const rows = await prisma.ledgerEntry.findMany({ where: { vehicleId: vehicle, category: "cost.insurance" } });
  return rows.reduce((sum, row) => sum + row.amountFils, 0n);
}

describe("a policy", () => {
  it("costs the premium net, on the day cover starts", async () => {
    const saved = await createPolicy(policy(), null);
    expect(saved).toMatchObject({
      premiumNetFils: aed("2000"),
      premiumVatFils: aed("100"),
      premiumFils: aed("2100"),
    });

    const entry = await prisma.ledgerEntry.findFirstOrThrow({
      where: { sourceType: "InsurancePolicy", sourceId: saved.id },
    });
    expect(entry).toMatchObject({ direction: "COST", category: "cost.insurance", amountFils: aed("2000"), periodMonth: 202601 });
  });

  it("refuses a duplicate policy number, dates out of order and a premium of nothing", async () => {
    const first = await createPolicy(policy(), null);
    await expect(createPolicy(policy({ policyNumber: first.policyNumber }), null)).rejects.toMatchObject({
      code: "duplicatePolicyNumber",
    });
    await expect(createPolicy(policy({ startDate: "2027-01-01", expiryDate: "2026-12-31" }), null)).rejects.toMatchObject(
      { code: "datesOutOfOrder" },
    );
    await expect(createPolicy(policy({ premiumNetFils: 0n }), null)).rejects.toBeInstanceOf(InsuranceRuleError);
  });

  it("is the cover in force today, and appears on the renewal list as it runs out", async () => {
    const saved = await createPolicy(policy({ startDate: "2026-01-01", expiryDate: "2026-12-31" }), null);
    expect((await currentPolicy(vehicleId, "2026-06-01"))?.id).toBe(saved.id);
    expect(await currentPolicy(vehicleId, "2027-06-01")).toBeNull();

    expect(policyState(saved, "2026-12-01")).toMatchObject({ status: "ACTIVE", daysToExpiry: 30 });
    expect(policyState(saved, "2027-01-15")).toMatchObject({ status: "EXPIRED" });

    const due = await policiesDueForRenewal("2026-12-05", 30);
    expect(due.map((row) => row.id)).toContain(saved.id);
    const notYet = await policiesDueForRenewal("2026-06-01", 30);
    expect(notYet.map((row) => row.id)).not.toContain(saved.id);
  });
});

describe("cancelling", () => {
  it("takes back the refund's net share as a reversal, leaving the original cost alone", async () => {
    const saved = await createPolicy(policy(), null);
    await cancelPolicy(saved.id, { reason: "Car sold", refundFils: aed("1050"), actorId: null, today: "2026-07-01" });

    const entries = await prisma.ledgerEntry.findMany({
      where: { vehicleId, category: "cost.insurance" },
      orderBy: { occurredOn: "asc" },
    });
    expect(entries).toHaveLength(2);
    // 1,050 refunded includes 50 of VAT; 1,000 comes off the cost.
    expect(entries[1]).toMatchObject({ amountFils: aed("-1000"), periodMonth: 202607, reversesId: entries[0]?.id });
    expect(await insuranceCost(vehicleId)).toBe(aed("1000"));

    await expect(
      cancelPolicy(saved.id, { reason: "Again", actorId: null, today: "2026-07-02" }),
    ).rejects.toMatchObject({ code: "alreadyCancelled" });
  });

  it("needs a reason, and cannot refund more than the premium", async () => {
    const saved = await createPolicy(policy(), null);
    await expect(cancelPolicy(saved.id, { reason: "  ", actorId: null, today: "2026-07-01" })).rejects.toMatchObject({
      code: "cancelNeedsReason",
    });
    await expect(
      cancelPolicy(saved.id, { reason: "Too much", refundFils: aed("9999"), actorId: null, today: "2026-07-01" }),
    ).rejects.toMatchObject({ code: "refundAbovePremium" });
  });
});

describe("the books", () => {
  it("report insurance cost against the insurance charged, with no change to the reporting layer", async () => {
    // The customer is charged 2,400 a year; the insurer's premium is 2,000 net.
    const draft = await createContract(
      {
        customerId,
        vehicleId,
        type: "LONG_TERM_RENTAL",
        startDate: "2026-01-01",
        durationMonths: 12,
        monthlyRentalFils: aed("3000"),
        annualInsuranceFils: aed("2400"),
      },
      null,
    );
    await activateContract(draft.id, { actorId: null, today: "2026-01-01" });
    await issueDueInstallments("2026-01-01");
    await createPolicy(policy(), null);

    const january = await monthResult("2026-01-15");
    expect(january.costFils).toBe(aed("2000"));

    const byVehicle = await profitReport("vehicle", 202601, 202601);
    const row = byVehicle.rows.find((r) => r.key === vehicleId);
    // Insurance revenue is reported apart from rental, and the premium sits in other cost.
    expect(row).toMatchObject({
      rentalFils: aed("3000"),
      insuranceFils: aed("2400"),
      otherCostFils: aed("2000"),
      supplierCostFils: 0n,
      profitFils: aed("3400"),
    });
  });
});
