/**
 * Handover and return against a real database (P2-01 – P2-03).
 *
 * The rules that matter here are evidentiary rather than arithmetical: what a form is
 * allowed to say, when it stops being editable, and what it takes with it when it is
 * signed. The one number it produces — excess mileage — is proved against the contract's
 * own terms, because that figure becomes a charge on a customer at the end.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { Money } from "@drivenx/core";

import { activateContract, createContract } from "./contracts";
import { createVehicle } from "./fleet";
import {
  addDamagePoint,
  discardHandover,
  excessMileageForContract,
  handoversForContract,
  HandoverRuleError,
  recordHandover,
  removeDamagePoint,
  signHandover,
  updateHandover,
  type NewHandover,
} from "./handovers";
import { prisma } from "./index";

const aed = (value: string) => Money.parse(value);

let customerId: string;
let vehicleId: string;
let contractId: string;
let serial = 0;

async function car(mileage = 20_000) {
  serial += 1;
  return createVehicle(
    {
      make: "Nissan",
      model: "Patrol",
      year: 2025,
      plateEmirate: "DUBAI",
      plateCode: "H",
      plateNumber: String(41000 + serial),
      vin: `JNRHAND${String(serial).padStart(10, "0")}`,
      currentMileageKm: mileage,
      ownershipType: "COMPANY_OWNED",
    },
    null,
  );
}

async function liveContract(terms: { allowanceKm?: number | null; rateFils?: bigint | null } = {}) {
  const draft = await createContract(
    {
      customerId,
      vehicleId,
      type: "LONG_TERM_RENTAL",
      startDate: "2026-01-01",
      durationMonths: 12,
      monthlyRentalFils: aed("3000"),
      mileageAllowanceKm: terms.allowanceKm === undefined ? 30_000 : terms.allowanceKm,
      excessMileageRateFils: terms.rateFils === undefined ? 50n : terms.rateFils,
    },
    null,
  );
  await activateContract(draft.id, { actorId: null, today: "2026-01-01" });
  return draft.id;
}

const form = (overrides: Partial<NewHandover> = {}): NewHandover => ({
  contractId,
  type: "HANDOVER",
  occurredAt: new Date("2026-01-01T09:30:00.000Z"),
  odometerKm: 20_000,
  fuelEighths: 8,
  conditionNotes: "Spare wheel and jack present.",
  ...overrides,
});

const SIGNATURES = {
  customerSignatureKey: "signatures/customer.png",
  customerSignatureName: "Fatima Al Marri",
  staffSignatureKey: "signatures/staff.png",
  staffSignatureName: "Omar Haddad",
};

beforeEach(async () => {
  customerId = (
    await prisma.customer.create({
      data: {
        code: `CUS-H${Date.now()}${serial}`,
        fullName: "Fatima Al Marri",
        mobile: "+971501234588",
      },
    })
  ).id;
  vehicleId = (await car()).id;
  contractId = await liveContract();
});

describe("recording the form", () => {
  it("keeps the marks made walking round the car, and names the panel from the picture", async () => {
    const handover = await recordHandover(
      form({
        damagePoints: [
          { positionX: 0.5, positionY: 0.2, severity: "MINOR", note: "Stone chip" },
          { panel: "INTERIOR", severity: "MODERATE", note: "Tear in the rear seat" },
        ],
      }),
      null,
    );

    expect(handover.status).toBe("DRAFT");
    expect(handover.damagePoints).toHaveLength(2);
    expect(handover.damagePoints[0]).toMatchObject({ panel: "BONNET", severity: "MINOR" });
    expect(handover.damagePoints[1]).toMatchObject({
      panel: "INTERIOR",
      positionX: null,
      positionY: null,
    });
  });

  it("takes the panel from where the mark was put, not from what was sent with it", async () => {
    // A form field claiming the boot cannot overrule a mark on the bonnet.
    const handover = await recordHandover(
      form({ damagePoints: [{ panel: "BOOT", positionX: 0.5, positionY: 0.2 }] }),
      null,
    );
    expect(handover.damagePoints[0]?.panel).toBe("BONNET");
  });

  it("refuses a mark off the car", async () => {
    await expect(
      recordHandover(form({ damagePoints: [{ positionX: 0.01, positionY: 0.5 }] }), null),
    ).rejects.toThrow(new HandoverRuleError("invalidDamagePoint"));
  });

  it("refuses a body panel with nowhere to draw it", async () => {
    await expect(
      recordHandover(form({ damagePoints: [{ panel: "BONNET" }] }), null),
    ).rejects.toThrow(new HandoverRuleError("invalidDamagePoint"));
  });

  it("refuses a fuel reading no gauge could show", async () => {
    await expect(recordHandover(form({ fuelEighths: 9 }), null)).rejects.toThrow(
      new HandoverRuleError("fuelOutOfRange"),
    );
  });

  it("allows only one of each per contract", async () => {
    await recordHandover(form(), null);
    await expect(recordHandover(form(), null)).rejects.toThrow(
      new HandoverRuleError("handoverExists"),
    );
  });

  it("refuses a return before the car ever went out", async () => {
    await expect(
      recordHandover(form({ type: "RETURN", odometerKm: 25_000 }), null),
    ).rejects.toThrow(new HandoverRuleError("noHandoverYet"));
  });

  it("refuses a return on an odometer below the one it went out on", async () => {
    await recordHandover(form(), null);
    await expect(
      recordHandover(form({ type: "RETURN", odometerKm: 19_000 }), null),
    ).rejects.toThrow(new HandoverRuleError("returnBeforeHandover"));
  });

  it("refuses a handover on a contract that is not live", async () => {
    const draft = await createContract(
      {
        customerId,
        vehicleId: (await car(10_000)).id,
        type: "LONG_TERM_RENTAL",
        startDate: "2026-01-01",
        durationMonths: 12,
        monthlyRentalFils: aed("3000"),
      },
      null,
    );
    await expect(recordHandover(form({ contractId: draft.id }), null)).rejects.toThrow(
      new HandoverRuleError("contractNotOpen"),
    );
  });
});

describe("while it is still a draft", () => {
  it("leaves the fleet's mileage alone until someone signs", async () => {
    await recordHandover(form({ odometerKm: 26_000 }), null);

    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    // An abandoned draft must not raise the car's mileage: mileage never comes back down,
    // and the next real reading would be refused.
    expect(vehicle.currentMileageKm).toBe(20_000);
    // Only the reading the car joined the fleet on; the draft has added none.
    expect(await prisma.mileageReading.count({ where: { vehicleId } })).toBe(1);
    expect(await prisma.mileageReading.count({ where: { vehicleId, readingKm: 26_000 } })).toBe(0);
  });

  it("takes corrections to the fuel and the condition", async () => {
    const handover = await recordHandover(form(), null);
    const updated = await updateHandover(handover.id, {
      fuelEighths: 6,
      conditionNotes: "Warning light on",
    });
    expect(updated).toMatchObject({ fuelEighths: 6, conditionNotes: "Warning light on" });
  });

  it("takes marks added and removed, with their photographs", async () => {
    const handover = await recordHandover(form(), null);
    const point = await addDamagePoint(
      handover.id,
      { positionX: 0.22, positionY: 0.4, severity: "SEVERE" },
      null,
    );
    expect(point.panel).toBe("FRONT_LEFT_DOOR");

    const category = await prisma.documentCategory.create({
      data: {
        key: `damage_photo_${Date.now()}`,
        label: "Damage photo",
        appliesTo: ["DAMAGE_POINT"],
        requiresExpiry: false,
      },
    });
    await prisma.document.create({
      data: {
        ownerType: "DAMAGE_POINT",
        ownerId: point.id,
        categoryId: category.id,
        fileKey: "photos/scratch.jpg",
        fileName: "scratch.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1024,
      },
    });

    await removeDamagePoint(point.id);
    expect(await prisma.damagePoint.count({ where: { handoverId: handover.id } })).toBe(0);
    // The photograph goes with the mark rather than outliving it as an orphan.
    expect(
      await prisma.document.count({ where: { ownerType: "DAMAGE_POINT", ownerId: point.id } }),
    ).toBe(0);
  });

  it("can be thrown away", async () => {
    const handover = await recordHandover(form(), null);
    await discardHandover(handover.id);
    expect(await handoversForContract(contractId)).toHaveLength(0);
    // And the slot frees up, because the car did go out and someone has to record it.
    await expect(recordHandover(form({ odometerKm: 20_500 }), null)).resolves.toBeTruthy();
  });
});

describe("signing", () => {
  it("takes both signatures, freezes the form and posts the reading to the fleet", async () => {
    const handover = await recordHandover(form({ odometerKm: 21_000 }), null);
    const signed = await signHandover(handover.id, SIGNATURES, null);

    expect(signed.status).toBe("SIGNED");
    expect(signed.customerSignatureName).toBe("Fatima Al Marri");
    expect(signed.customerSignedAt).toBeInstanceOf(Date);
    expect(signed.staffSignedAt).toBeInstanceOf(Date);

    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    expect(vehicle.currentMileageKm).toBe(21_000);

    const reading = await prisma.mileageReading.findFirstOrThrow({ where: { vehicleId } });
    expect(reading).toMatchObject({ readingKm: 21_000, note: "Handover" });
    // Read on the day the car changed hands, not the day the form was typed up.
    expect(reading.readAt.toISOString()).toBe("2026-01-01T09:30:00.000Z");
  });

  it("refuses one signature without the other", async () => {
    const handover = await recordHandover(form(), null);
    await expect(
      signHandover(handover.id, { ...SIGNATURES, staffSignatureName: "  " }, null),
    ).rejects.toThrow(new HandoverRuleError("signatureIncomplete"));
    expect((await prisma.handover.findUniqueOrThrow({ where: { id: handover.id } })).status).toBe(
      "DRAFT",
    );
  });

  it("stops the form being edited once it is evidence", async () => {
    const handover = await recordHandover(form(), null);
    await signHandover(handover.id, SIGNATURES, null);

    await expect(updateHandover(handover.id, { fuelEighths: 1 })).rejects.toThrow(
      new HandoverRuleError("handoverSigned"),
    );
    await expect(
      addDamagePoint(handover.id, { positionX: 0.5, positionY: 0.5 }, null),
    ).rejects.toThrow(new HandoverRuleError("handoverSigned"));
    await expect(discardHandover(handover.id)).rejects.toThrow(
      new HandoverRuleError("handoverSigned"),
    );
    await expect(signHandover(handover.id, SIGNATURES, null)).rejects.toThrow(
      new HandoverRuleError("handoverSigned"),
    );
  });

  it("refuses a reading that would take the odometer backwards", async () => {
    const handover = await recordHandover(form({ odometerKm: 20_000 }), null);
    // The car was read higher elsewhere — at a garage — while the form sat in draft.
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { currentMileageKm: 23_000 } });

    await expect(signHandover(handover.id, SIGNATURES, null)).rejects.toThrow(
      new HandoverRuleError("odometerBackwards"),
    );
  });
});

describe("excess mileage at the end (feeding P2-12)", () => {
  async function outAndBack(handoverKm: number, returnKm: number) {
    const out = await recordHandover(form({ odometerKm: handoverKm }), null);
    await signHandover(out.id, SIGNATURES, null);
    const back = await recordHandover(
      form({
        type: "RETURN",
        odometerKm: returnKm,
        occurredAt: new Date("2026-12-31T17:00:00.000Z"),
      }),
      null,
    );
    await signHandover(back.id, SIGNATURES, null);
    return { out, back };
  }

  it("charges the kilometres over the contract's allowance at its rate", async () => {
    await outAndBack(20_000, 53_400);

    const excess = await excessMileageForContract(contractId);
    expect(excess).toMatchObject({
      handoverKm: 20_000,
      returnKm: 53_400,
      travelledKm: 33_400,
      excessKm: 3_400,
      netFils: aed("1700"), // 3,400 km × AED 0.50
      chargeable: true,
    });
  });

  it("charges nothing inside the allowance", async () => {
    await outAndBack(20_000, 45_000);
    expect(await excessMileageForContract(contractId)).toMatchObject({
      excessKm: 0,
      chargeable: false,
    });
  });

  it("says nothing at all until both forms are signed", async () => {
    expect(await excessMileageForContract(contractId)).toBeNull();

    const out = await recordHandover(form(), null);
    await signHandover(out.id, SIGNATURES, null);
    expect(await excessMileageForContract(contractId)).toBeNull();

    const back = await recordHandover(form({ type: "RETURN", odometerKm: 60_000 }), null);
    // Unsigned: a reading nobody has agreed to is not one to raise a charge from.
    expect(await excessMileageForContract(contractId)).toBeNull();

    await signHandover(back.id, SIGNATURES, null);
    expect(await excessMileageForContract(contractId)).toMatchObject({ chargeable: true });
  });

  it("charges nothing on a contract with no allowance or no rate", async () => {
    vehicleId = (await car(5_000)).id;
    contractId = await liveContract({ allowanceKm: null });
    const out = await recordHandover(form({ odometerKm: 5_000 }), null);
    await signHandover(out.id, SIGNATURES, null);
    const back = await recordHandover(form({ type: "RETURN", odometerKm: 99_000 }), null);
    await signHandover(back.id, SIGNATURES, null);

    expect(await excessMileageForContract(contractId)).toMatchObject({
      travelledKm: 94_000,
      excessKm: 0,
      chargeable: false,
    });
  });
});
