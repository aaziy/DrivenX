/**
 * The expiry scan against a real database.
 *
 * The property that matters is not "it writes a notification" but "it writes exactly one,
 * however many times it runs". A scan that re-announces the same expiry every night
 * trains everybody to ignore the notification list, at which point the feature is worse
 * than not having it.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { reminderDedupeKey } from "@drivenx/core";
import { prisma } from "@drivenx/db";

import { runExpiryScan } from "./expiry-scan";

// Noon in Dubai, so adding whole days never crosses a day boundary by accident.
const NOW = new Date("2026-09-17T08:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const daysFromNow = (days: number) => new Date(NOW.getTime() + days * DAY_MS);

async function makeCustomer(suffix: string) {
  return prisma.customer.create({
    data: { code: `CUS-TEST-${suffix}`, fullName: `Ahmed ${suffix}`, mobile: "+971501234567" },
  });
}

async function makeCategory(offsets: number[] = [60, 30, 15, 7]) {
  return prisma.documentCategory.create({
    data: {
      key: `cat_${Math.random().toString(36).slice(2, 10)}`,
      label: "Emirates ID",
      appliesTo: ["CUSTOMER"],
      requiresExpiry: true,
      defaultReminderOffsets: offsets,
    },
  });
}

async function attachDocument(
  ownerId: string,
  categoryId: string,
  expiryDate: Date | null,
  offsets: number[] = [60, 30, 15, 7],
) {
  return prisma.document.create({
    data: {
      ownerType: "CUSTOMER",
      ownerId,
      categoryId,
      expiryDate,
      fileKey: `customer/${ownerId}/${Math.random().toString(36).slice(2)}.pdf`,
      fileName: "emirates-id.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      reminderOffsets: offsets,
    },
  });
}

describe("runExpiryScan", () => {
  let customerId: string;
  let categoryId: string;

  beforeEach(async () => {
    customerId = (await makeCustomer("a")).id;
    categoryId = (await makeCategory()).id;
  });

  it("raises exactly one notification for a document expiring in 29 days", async () => {
    // The milestone's exit criterion. Both the 60- and the 30-day offsets have been
    // crossed, but only the tightest one is a true statement today.
    const document = await attachDocument(customerId, categoryId, daysFromNow(29));

    const result = await runExpiryScan(NOW);

    expect(result.notificationsCreated).toBe(1);

    const notifications = await prisma.notification.findMany({
      where: { entityId: document.id },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.dedupeKey).toBe(reminderDedupeKey(document.id, 30));
    expect(notifications[0]?.severity).toBe("WARNING");
  });

  it("names whose document it is, because otherwise nobody can act on it", async () => {
    const document = await attachDocument(customerId, categoryId, daysFromNow(29));

    await runExpiryScan(NOW);

    const notification = await prisma.notification.findFirstOrThrow({
      where: { entityId: document.id },
    });
    expect(notification.body).toContain("Ahmed a");
    expect(notification.body).toContain("CUS-TEST-a");
    expect(notification.title).toContain("Emirates ID");
  });

  it("writes nothing new on a second run the same day", async () => {
    await attachDocument(customerId, categoryId, daysFromNow(29));

    const first = await runExpiryScan(NOW);
    const second = await runExpiryScan(NOW);

    expect(first.notificationsCreated).toBe(1);
    expect(second.notificationsCreated).toBe(0);
    expect(await prisma.notification.count()).toBe(1);
  });

  it("raises the next warning when a tighter offset is crossed", async () => {
    const document = await attachDocument(customerId, categoryId, daysFromNow(29));

    await runExpiryScan(NOW);
    // Fifteen days later the document is 14 days out, so the 15-day warning is due.
    await runExpiryScan(daysFromNow(15));

    const keys = (
      await prisma.notification.findMany({
        where: { entityId: document.id },
        select: { dedupeKey: true },
      })
    ).map((row) => row.dedupeKey);

    expect(keys.sort()).toEqual(
      [reminderDedupeKey(document.id, 30), reminderDedupeKey(document.id, 15)].sort(),
    );
  });

  it("raises a critical alert once a document has expired", async () => {
    const document = await attachDocument(customerId, categoryId, daysFromNow(-3));

    await runExpiryScan(NOW);
    await runExpiryScan(NOW);

    const notifications = await prisma.notification.findMany({
      where: { entityId: document.id },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.severity).toBe("CRITICAL");
    expect(notifications[0]?.title).toContain("expired");
  });

  it("treats a document expiring today as expiring, not expired", async () => {
    // It is valid for the whole of today. Telling someone their customer's licence has
    // expired while it has not is how the alerts stop being believed.
    const document = await attachDocument(customerId, categoryId, daysFromNow(0));

    await runExpiryScan(NOW);

    const notification = await prisma.notification.findFirstOrThrow({
      where: { entityId: document.id },
    });
    expect(notification.severity).toBe("WARNING");
    expect(await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).toMatchObject({
      status: "EXPIRING",
    });
  });

  it("ignores a document with no expiry date", async () => {
    const category = await makeCategory([]);
    const document = await attachDocument(customerId, category.id, null, []);

    const result = await runExpiryScan(NOW);

    expect(await prisma.notification.count({ where: { entityId: document.id } })).toBe(0);
    expect(result.notificationsCreated).toBe(0);
  });

  it("leaves a document that is nowhere near expiry alone", async () => {
    const document = await attachDocument(customerId, categoryId, daysFromNow(200));

    await runExpiryScan(NOW);

    expect(await prisma.notification.count({ where: { entityId: document.id } })).toBe(0);
    expect(await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).toMatchObject({
      status: "VALID",
    });
  });

  it("brings the stored status in line with the date", async () => {
    const expiring = await attachDocument(customerId, categoryId, daysFromNow(10));
    const expired = await attachDocument(customerId, categoryId, daysFromNow(-1));

    const result = await runExpiryScan(NOW);

    expect(result.statusesUpdated).toBe(2);
    expect(
      (await prisma.document.findUniqueOrThrow({ where: { id: expiring.id } })).status,
    ).toBe("EXPIRING");
    expect((await prisma.document.findUniqueOrThrow({ where: { id: expired.id } })).status).toBe(
      "EXPIRED",
    );
  });

  it("names a vehicle document by the car's plate, not its database id", async () => {
    // An expiring mulkiya is only actionable if it says which car — and the plate is
    // what staff read in the yard and write on the renewal form.
    const car = await prisma.vehicle.create({
      data: {
        code: "VEH-TEST-1",
        make: "Nissan",
        model: "Patrol",
        year: 2023,
        plateEmirate: "DUBAI",
        plateCode: "K",
        plateNumber: "40721",
        vin: "JN8AY2NY0P9123456",
        ownershipType: "COMPANY_OWNED",
      },
    });
    const mulkiya = await prisma.documentCategory.create({
      data: {
        key: `mulkiya_${Math.random().toString(36).slice(2, 8)}`,
        label: "Vehicle registration (mulkiya)",
        appliesTo: ["VEHICLE"],
        defaultReminderOffsets: [60, 30, 15, 7],
      },
    });
    const document = await prisma.document.create({
      data: {
        ownerType: "VEHICLE",
        ownerId: car.id,
        categoryId: mulkiya.id,
        expiryDate: daysFromNow(12),
        fileKey: `vehicle/${car.id}/m.pdf`,
        fileName: "mulkiya.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        reminderOffsets: [60, 30, 15, 7],
      },
    });

    await runExpiryScan(NOW);

    const notification = await prisma.notification.findFirstOrThrow({
      where: { entityId: document.id },
    });
    expect(notification.body).toContain("K 40721");
    expect(notification.body).toContain("VEH-TEST-1");
    expect(notification.body).not.toContain(car.id);
  });

  it("skips a document that has been replaced or removed", async () => {
    const replaced = await attachDocument(customerId, categoryId, daysFromNow(5));
    await prisma.document.update({ where: { id: replaced.id }, data: { status: "REPLACED" } });

    const removed = await attachDocument(customerId, categoryId, daysFromNow(5));
    await prisma.document.update({ where: { id: removed.id }, data: { deletedAt: new Date() } });

    const result = await runExpiryScan(NOW);

    expect(result.notificationsCreated).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });
});
