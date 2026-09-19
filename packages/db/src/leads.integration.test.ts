/**
 * Leads against a real database (milestone 1F).
 *
 * The test the plan singles out: conversion carries the salesperson through to the
 * contract. And the pipeline's earned stages can only be earned.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { IllegalLeadTransitionError, Money } from "@drivenx/core";

import { ContractRuleError } from "./contracts";
import { createVehicle } from "./fleet";
import { prisma } from "./index";
import { changeLeadStatus, convertLead, createLead, leadScope, LeadRuleError, saveQuote } from "./leads";

const aed = (value: string) => Money.parse(value);

let salesId: string;
let managerId: string;
let serial = 0;

async function car(ownershipType: "COMPANY_OWNED" | "B2B_SUPPLIER" = "COMPANY_OWNED") {
  serial += 1;
  const supplier =
    ownershipType === "B2B_SUPPLIER"
      ? await prisma.supplier.create({ data: { code: `SUP-L${Date.now()}${serial}`, companyName: "Lead Leasing" } })
      : null;
  return createVehicle(
    {
      make: "Nissan",
      model: "Altima",
      year: 2025,
      plateEmirate: "DUBAI",
      plateCode: "L",
      plateNumber: String(70000 + serial),
      vin: `1N4LEAD${String(serial).padStart(10, "0")}`,
      currentMileageKm: 0,
      ownershipType,
      supplierId: supplier?.id ?? null,
      supplierMonthlyCostFils: supplier ? aed("2000") : null,
    },
    null,
  );
}

async function user(email: string) {
  return prisma.user.create({ data: { email, fullName: email.split("@")[0]!, passwordHash: "x" } });
}

beforeEach(async () => {
  salesId = (await user(`sales.${Date.now()}@drivenx.ae`)).id;
  managerId = (await user(`manager.${Date.now()}@drivenx.ae`)).id;
});

const quote = (vehicleId: string) => ({
  vehicleId,
  type: "LONG_TERM_RENTAL" as const,
  durationMonths: 12,
  monthlyRentalFils: aed("3200"),
});

describe("a lead", () => {
  it("is owned by whoever records it, with a code and a normalised mobile", async () => {
    const lead = await createLead({ name: " Khalid ", mobile: "050 111 2233", source: "WALK_IN" }, salesId);
    expect(lead).toMatchObject({ name: "Khalid", status: "NEW", salespersonId: salesId, source: "WALK_IN" });
    expect(lead.code).toMatch(/^LEAD-\d{5}$/);
    expect(lead.mobile).not.toContain(" ");
    await expect(createLead({ name: "X", mobile: "12" }, salesId)).rejects.toMatchObject({ code: "invalidMobile" });
  });

  it("moves by hand only to stages a person can reach, and says why it was lost", async () => {
    const lead = await createLead({ name: "Aisha", mobile: "0501112234" }, salesId);
    await changeLeadStatus(lead.id, "CONTACTED", { actorId: salesId });

    await expect(changeLeadStatus(lead.id, "DEAL_CREATED", { actorId: salesId })).rejects.toMatchObject({
      code: "statusEarned",
    });
    await expect(changeLeadStatus(lead.id, "NEW", { actorId: salesId })).rejects.toBeInstanceOf(
      IllegalLeadTransitionError,
    );
    await expect(changeLeadStatus(lead.id, "LOST", { actorId: salesId })).rejects.toMatchObject({
      code: "lostNeedsReason",
    });

    await changeLeadStatus(lead.id, "LOST", { actorId: salesId, reason: "Went with a competitor" });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).lostReason).toBe("Went with a competitor");

    // Reopened: the reason goes with it.
    await changeLeadStatus(lead.id, "CONTACTED", { actorId: salesId });
    const reopened = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(reopened).toMatchObject({ status: "CONTACTED", lostReason: null });
  });
});

describe("quotes", () => {
  it("make a lead Deal created, passing through Qualified, and keep every quote", async () => {
    const vehicle = await car();
    const lead = await createLead({ name: "Omar", mobile: "0501112235" }, salesId);

    await saveQuote(lead.id, quote(vehicle.id), salesId);
    await saveQuote(lead.id, { ...quote(vehicle.id), monthlyRentalFils: aed("3000") }, salesId);

    const saved = await prisma.lead.findUniqueOrThrow({
      where: { id: lead.id },
      include: { quotes: true, statusChanges: { orderBy: { changedAt: "asc" } } },
    });
    expect(saved.status).toBe("DEAL_CREATED");
    expect(saved.quotes).toHaveLength(2);
    expect(saved.statusChanges.map((c) => c.toStatus)).toEqual(["NEW", "QUALIFIED", "DEAL_CREATED"]);
  });

  it("offer a car leased from a supplier only as lease-to-own", async () => {
    const leased = await car("B2B_SUPPLIER");
    const lead = await createLead({ name: "Sara", mobile: "0501112236" }, salesId);
    await expect(saveQuote(lead.id, quote(leased.id), salesId)).rejects.toMatchObject({
      code: "leasedCarNotLeaseToOwn",
    });
    await saveQuote(lead.id, { ...quote(leased.id), type: "LEASE_TO_OWN" }, salesId);
  });
});

describe("conversion", () => {
  it("carries the salesperson through to the contract, whoever converts it (P1F-04)", async () => {
    const vehicle = await car();
    const lead = await createLead({ name: "Rashid", mobile: "0501112237", email: "r@example.ae" }, salesId);
    await saveQuote(lead.id, { ...quote(vehicle.id), downPaymentFils: aed("5000") }, salesId);

    // The manager converts it; the sale is still the salesperson's.
    const result = await convertLead(lead.id, { startDate: "2026-10-01", actorId: managerId });

    expect(result.customerCreated).toBe(true);
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: result.contract.id } });
    expect(contract).toMatchObject({
      leadId: lead.id,
      salespersonId: salesId,
      createdById: managerId,
      status: "DRAFT",
      monthlyRentalFils: aed("3200"),
      downPaymentFils: aed("5000"),
      durationMonths: 12,
    });
    const converted = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(converted).toMatchObject({ status: "CONTRACTED", customerId: result.customerId });
  });

  it("uses the customer already on file with the same mobile", async () => {
    const existing = await prisma.customer.create({
      data: { code: `CUS-L${Date.now()}`, fullName: "Rashid A.", mobile: "+971501112238" },
    });
    const vehicle = await car();
    const lead = await createLead({ name: "Rashid", mobile: "050 111 2238" }, salesId);
    await saveQuote(lead.id, quote(vehicle.id), salesId);

    const result = await convertLead(lead.id, { startDate: "2026-10-01", actorId: salesId });
    expect(result).toMatchObject({ customerId: existing.id, customerCreated: false });
  });

  it("refuses a lead without a deal, and rolls everything back when the contract is refused", async () => {
    const vehicle = await car();
    const early = await createLead({ name: "Early", mobile: "0501112239" }, salesId);
    await expect(convertLead(early.id, { startDate: "2026-10-01", actorId: salesId })).rejects.toBeInstanceOf(
      LeadRuleError,
    );

    // A blacklisted customer on file with the lead's mobile: the contract is refused.
    await prisma.customer.create({
      data: { code: `CUS-X${Date.now()}`, fullName: "Barred", mobile: "+971501112240", status: "BLACKLISTED" },
    });
    const barred = await createLead({ name: "Barred", mobile: "0501112240" }, salesId);
    await saveQuote(barred.id, quote(vehicle.id), salesId);
    const contractsBefore = await prisma.contract.count();

    await expect(convertLead(barred.id, { startDate: "2026-10-01", actorId: salesId })).rejects.toBeInstanceOf(
      ContractRuleError,
    );
    expect(await prisma.contract.count()).toBe(contractsBefore);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: barred.id } })).status).toBe("DEAL_CREATED");
  });
});

describe("scope", () => {
  it("shows Sales Staff only their own leads (P1F-05)", async () => {
    await createLead({ name: "Mine", mobile: "0501112241" }, salesId);
    await createLead({ name: "Theirs", mobile: "0501112242" }, managerId);

    const mine = await prisma.lead.findMany({ where: leadScope({ id: salesId, seeAll: false }) });
    const all = await prisma.lead.findMany({ where: leadScope({ id: salesId, seeAll: true }) });
    expect(mine.map((l) => l.name)).toEqual(["Mine"]);
    expect(all.map((l) => l.name).sort()).toEqual(["Mine", "Theirs"]);
  });
});
