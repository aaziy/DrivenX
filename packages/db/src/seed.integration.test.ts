/**
 * The base seed's behaviour on a database that is already in use.
 *
 * The property under test is not "it inserts rows" but "it leaves the client's work
 * alone". SOW §17 hands document categories to the Super Admin to edit, and the seed
 * runs on every deploy — so a seed that reasserted its own labels would silently undo
 * their configuration on the next release, which is the kind of thing nobody notices
 * until a reminder schedule they tuned quietly reverts.
 */

import { describe, expect, it } from "vitest";

import { DOCUMENT_CATEGORIES } from "@drivenx/core";

import { seedDocumentCategories } from "../prisma/seed";
import { prisma } from "./index";

describe("seedDocumentCategories", () => {
  it("creates every category in the catalogue", async () => {
    await seedDocumentCategories();

    const rows = await prisma.documentCategory.findMany({ select: { key: true } });
    expect(rows.map((row) => row.key).sort()).toEqual(
      DOCUMENT_CATEGORIES.map((category) => category.key).sort(),
    );
  });

  it("carries each category's own reminder schedule, not one default", async () => {
    await seedDocumentCategories();

    const passport = await prisma.documentCategory.findUniqueOrThrow({
      where: { key: "passport" },
    });
    const insurance = await prisma.documentCategory.findUniqueOrThrow({
      where: { key: "insurance_policy" },
    });

    // Renewing a passport takes longer than renewing a policy, so they warn differently.
    expect(passport.defaultReminderOffsets).toEqual([90, 60, 30]);
    expect(insurance.defaultReminderOffsets).toEqual([30, 15, 7]);
  });

  it("records which kinds of record a category may be attached to", async () => {
    await seedDocumentCategories();

    const emiratesId = await prisma.documentCategory.findUniqueOrThrow({
      where: { key: "emirates_id" },
    });
    expect(emiratesId.appliesTo).toEqual(["CUSTOMER"]);
    expect(emiratesId.requiresExpiry).toBe(true);
  });

  it("adds nothing on a second run", async () => {
    await seedDocumentCategories();
    const afterFirst = await prisma.documentCategory.count();

    await seedDocumentCategories();

    expect(await prisma.documentCategory.count()).toBe(afterFirst);
  });

  it("leaves a category the client has edited exactly as they left it", async () => {
    await seedDocumentCategories();
    await prisma.documentCategory.update({
      where: { key: "emirates_id" },
      data: { label: "بطاقة الهوية", defaultReminderOffsets: [45, 14], requiresExpiry: false },
    });

    await seedDocumentCategories();

    const edited = await prisma.documentCategory.findUniqueOrThrow({
      where: { key: "emirates_id" },
    });
    expect(edited.label).toBe("بطاقة الهوية");
    expect(edited.defaultReminderOffsets).toEqual([45, 14]);
    expect(edited.requiresExpiry).toBe(false);
  });

  it("still adds a category introduced by a later release", async () => {
    await seedDocumentCategories();
    await prisma.documentCategory.delete({ where: { key: "mulkiya" } });

    await seedDocumentCategories();

    expect(
      await prisma.documentCategory.findUnique({ where: { key: "mulkiya" } }),
    ).not.toBeNull();
  });
});
