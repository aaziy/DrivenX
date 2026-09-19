/**
 * The conversion funnel against a real database (P1F-06).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { businessDate, Money } from "@drivenx/core";

import { createVehicle } from "./fleet";
import { leadFunnel } from "./funnel";
import { prisma } from "./index";
import { changeLeadStatus, convertLead, createLead, saveQuote } from "./leads";

let salesId: string;
let otherId: string;
let vehicleId: string;
let serial = 0;
const today = businessDate(new Date());

const mobile = () => {
  serial += 1;
  return `05099${String(serial).padStart(5, "0")}`;
};

beforeEach(async () => {
  salesId = (await prisma.user.create({ data: { email: `f1.${Date.now()}@x.ae`, fullName: "Layla", passwordHash: "x" } })).id;
  otherId = (await prisma.user.create({ data: { email: `f2.${Date.now()}@x.ae`, fullName: "Hana", passwordHash: "x" } })).id;
  vehicleId = (
    await createVehicle(
      {
        make: "Kia",
        model: "K5",
        year: 2025,
        plateEmirate: "DUBAI",
        plateCode: "F",
        plateNumber: String(80000 + serial),
        vin: `KNAFUN${String(Date.now()).slice(-11)}`,
        currentMileageKm: 0,
        ownershipType: "COMPANY_OWNED",
      },
      null,
    )
  ).id;
});

const quote = () => ({
  vehicleId,
  type: "LONG_TERM_RENTAL" as const,
  durationMonths: 12,
  monthlyRentalFils: Money.parse("3000"),
});

describe("the funnel", () => {
  it("counts how far each lead got, from its history, and why the lost ones were lost", async () => {
    // One stays new; one is contacted; one priced then lost; one converted.
    await createLead({ name: "A", mobile: mobile(), source: "WALK_IN" }, salesId);
    const b = await createLead({ name: "B", mobile: mobile(), source: "PHONE" }, salesId);
    await changeLeadStatus(b.id, "CONTACTED", { actorId: salesId });
    const c = await createLead({ name: "C", mobile: mobile(), source: "PHONE" }, salesId);
    await saveQuote(c.id, quote(), salesId);
    await changeLeadStatus(c.id, "LOST", { actorId: salesId, reason: "Too expensive" });
    const d = await createLead({ name: "D", mobile: mobile(), source: "WALK_IN" }, otherId);
    await saveQuote(d.id, quote(), otherId);
    await convertLead(d.id, { startDate: "2026-10-01", actorId: otherId });

    const funnel = await leadFunnel({ from: today, to: today, scope: { id: salesId, seeAll: true } });

    // New, Contacted, Qualified, Deal created, Contracted. A stage counts every lead that
    // got that far or further: C and D were priced straight from New, so they are past
    // Contacted too, and the funnel only ever narrows.
    expect(funnel.created).toBe(4);
    expect(funnel.reached).toEqual([4, 3, 2, 2, 1]);
    expect(funnel.lost).toBe(1);
    expect(funnel.lostReasons).toEqual([{ reason: "Too expensive", count: 1 }]);

    const layla = funnel.bySalesperson.find((row) => row.salespersonId === salesId);
    expect(layla).toMatchObject({ name: "Layla", created: 3, lost: 1 });
    expect(funnel.bySource.find((row) => row.source === "PHONE")?.created).toBe(2);
  });

  it("gives a salesperson only their own funnel", async () => {
    await createLead({ name: "Mine", mobile: mobile() }, salesId);
    await createLead({ name: "Theirs", mobile: mobile() }, otherId);

    const own = await leadFunnel({ from: today, to: today, scope: { id: salesId, seeAll: false } });
    expect(own.created).toBe(1);
    // Asking for a colleague's funnel without seeing everyone's still gives one's own.
    const asked = await leadFunnel({ from: today, to: today, scope: { id: salesId, seeAll: false }, salespersonId: otherId });
    expect(asked.created).toBe(1);
  });

  it("counts only leads recorded in the range", async () => {
    await createLead({ name: "Today", mobile: mobile() }, salesId);
    const funnel = await leadFunnel({ from: "2020-01-01", to: "2020-12-31", scope: { id: salesId, seeAll: true } });
    expect(funnel.created).toBe(0);
    expect(funnel.reached).toEqual([0, 0, 0, 0, 0]);
  });
});
