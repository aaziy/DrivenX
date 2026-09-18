/**
 * Global search against a real database.
 *
 * Trigram matching cannot be tested without Postgres — the whole point is what the
 * database does with a misspelling, and a mocked query would only prove that the string
 * I wrote is the string I wrote.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { createVehicle } from "./fleet";
import { prisma } from "./index";
import { globalSearch } from "./search";

async function makeCustomer(code: string, fullName: string, mobile: string, email?: string) {
  return prisma.customer.create({ data: { code, fullName, mobile, email: email ?? null } });
}

beforeEach(async () => {
  await makeCustomer("CUS-00041", "Ahmed Al Mansoori", "+971501234567", "ahmed@example.com");
  await makeCustomer("CUS-00042", "Fatima Al Suwaidi", "+971559876543");

  await prisma.supplier.create({
    data: {
      code: "SUP-00007",
      companyName: "Gulf Premier Motors",
      contactPerson: "Khalid Rahman",
      trn: "100123456789012",
    },
  });
});

describe("globalSearch", () => {
  it("finds a customer by name", async () => {
    const hits = await globalSearch("Mansoori");
    expect(hits[0]?.kind).toBe("customer");
    expect(hits[0]?.label).toBe("Ahmed Al Mansoori");
  });

  it("finds a name that was spelled differently", async () => {
    // The reason this is a trigram index and not an ILIKE. An Arabic surname transliterated
    // into Latin has no single correct spelling, and "%Mansouri%" does not appear anywhere
    // in "Ahmed Al Mansoori" — substring matching finds nothing here.
    const hits = await globalSearch("Mansouri");

    expect(hits.map((h) => h.label)).toContain("Ahmed Al Mansoori");
  });

  it("finds a customer from a mobile number typed the way people say it", async () => {
    // Stored as +971501234567; nobody types it that way.
    const hits = await globalSearch("050 123 4567");
    expect(hits[0]?.label).toBe("Ahmed Al Mansoori");
  });

  it("finds a customer by the code read out over the phone", async () => {
    for (const typed of ["CUS-00041", "cus 41", "CUS41"]) {
      const hits = await globalSearch(typed);
      expect(hits[0]?.label, `searching ${typed}`).toBe("Ahmed Al Mansoori");
    }
  });

  it("ranks an exact code above a fuzzy name match", async () => {
    const hits = await globalSearch("CUS-00042");
    expect(hits[0]?.label).toBe("Fatima Al Suwaidi");
  });

  it("finds a supplier by company, contact or TRN", async () => {
    expect((await globalSearch("Gulf Premier"))[0]?.kind).toBe("supplier");
    expect((await globalSearch("Khalid"))[0]?.label).toBe("Gulf Premier Motors");
    expect((await globalSearch("100123456789012"))[0]?.label).toBe("Gulf Premier Motors");
  });

  it("finds a document by the number printed on it", async () => {
    const customer = await prisma.customer.findFirstOrThrow({ where: { code: "CUS-00041" } });
    const category = await prisma.documentCategory.create({
      data: { key: `k_${Date.now()}`, label: "Emirates ID", appliesTo: ["CUSTOMER"] },
    });
    await prisma.document.create({
      data: {
        ownerType: "CUSTOMER",
        ownerId: customer.id,
        categoryId: category.id,
        documentNumber: "784-1990-1000000-0",
        fileKey: "customer/x/y.pdf",
        fileName: "eid.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        reminderOffsets: [30],
      },
    });

    const hits = await globalSearch("784-1990-1000000-0");

    // The number is on the document, not the customer — and the link has to lead back
    // to the person it belongs to.
    expect(hits[0]?.kind).toBe("document");
    expect(hits[0]?.ownerType).toBe("CUSTOMER");
    expect(hits[0]?.ownerId).toBe(customer.id);
  });

  it("finds a vehicle by the plate as it is written, its VIN, or its fleet code", async () => {
    const car = await createVehicle(
      {
        make: "Nissan",
        model: "Patrol",
        year: 2023,
        plateEmirate: "DUBAI",
        plateCode: "K",
        plateNumber: "40721",
        vin: "JN8AY2NY0P9123456",
        currentMileageKm: 0,
        ownershipType: "COMPANY_OWNED",
      },
      null,
    );

    // "K 40721" is how a plate is read out; it is stored as code and number apart.
    for (const typed of ["K 40721", "40721", "K40721", "k 40721"]) {
      expect((await globalSearch(typed))[0]?.id, `searching ${typed}`).toBe(car.id);
    }
    expect((await globalSearch("P9123456"))[0]?.id).toBe(car.id);
    expect((await globalSearch(car.code.toLowerCase().replace("-", " ")))[0]?.id).toBe(car.id);
    expect((await globalSearch("Nissan Patrol"))[0]?.kind).toBe("vehicle");
  });

  it("keeps vehicles out of a search that may not see them", async () => {
    await createVehicle(
      {
        make: "Lexus",
        model: "LX",
        year: 2024,
        plateEmirate: "DUBAI",
        plateCode: "L",
        plateNumber: "31337",
        vin: "JTJHY7AX0R4123456",
        currentMileageKm: 0,
        ownershipType: "COMPANY_OWNED",
      },
      null,
    );

    expect(await globalSearch("31337", { vehicles: false })).toEqual([]);
  });

  it("searches only what the caller is allowed to see", async () => {
    // The page decides this from the signed-in user's permissions; without it, a
    // salesperson searching a name would be shown supplier bank contacts.
    const hits = await globalSearch("Gulf Premier", { suppliers: false });
    expect(hits).toEqual([]);
  });

  it("ignores a record that has been removed", async () => {
    const customer = await prisma.customer.findFirstOrThrow({ where: { code: "CUS-00042" } });
    await prisma.customer.update({
      where: { id: customer.id },
      data: { deletedAt: new Date() },
    });

    expect(await globalSearch("Suwaidi")).toEqual([]);
  });

  it("returns nothing for a query too short to mean anything", async () => {
    // A single character matches most of the database and answers no question.
    expect(await globalSearch("a")).toEqual([]);
    expect(await globalSearch(" ")).toEqual([]);
  });

  it("returns nothing rather than everything when there is no match", async () => {
    expect(await globalSearch("Zzzyxwvu")).toEqual([]);
  });
});
