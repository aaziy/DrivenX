"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { prisma, type DocumentOwnerType } from "@drivenx/db";

import { asActor, requirePermission } from "@/lib/auth";
import { toUserMessage } from "@/lib/log";

export interface CategoryFormState {
  error?: string;
  success?: string;
}

const OWNER_TYPES = [
  "CUSTOMER",
  "SUPPLIER",
  "VEHICLE",
  "CONTRACT",
  "INSURANCE_POLICY",
] as const satisfies readonly DocumentOwnerType[];

/**
 * "60, 30, 15, 7" as people type it — spaces, trailing commas, Arabic comma included.
 * Returns null when any part is not a whole number of days.
 */
function parseReminders(input: string): number[] | null {
  const parts = input
    .replace(/[،]/g, ",")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const days: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,4}$/.test(part)) return null;
    days.push(Number(part));
  }

  // Widest first, matching the seeded schedules and how the engine reports them.
  return [...new Set(days)].sort((a, b) => b - a);
}

/** A stable key derived from the first label, since the client may rename it later. */
function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base.length > 0 ? base.slice(0, 48) : `category_${Date.now()}`;
}

async function readForm(formData: FormData) {
  const t = await getTranslations("documentCategories.errors");

  const appliesTo = formData
    .getAll("appliesTo")
    .map(String)
    .filter((value): value is DocumentOwnerType =>
      (OWNER_TYPES as readonly string[]).includes(value),
    );

  const parsed = z
    .object({
      label: z.string().trim().min(2, t("label")),
      requiresExpiry: z.boolean(),
      reminders: z.string(),
    })
    .safeParse({
      label: formData.get("label") ?? "",
      requiresExpiry: formData.get("requiresExpiry") === "on",
      reminders: String(formData.get("reminders") ?? ""),
    });

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("label") } as const;
  if (appliesTo.length === 0) return { error: t("appliesTo") } as const;

  const reminders = parseReminders(parsed.data.reminders);
  if (reminders === null) return { error: t("reminders") } as const;

  // A type that expires with no warnings is a type nobody is ever told about, which is
  // the one thing this whole feature exists to prevent.
  if (parsed.data.requiresExpiry && reminders.length === 0) {
    return { error: t("expiryNeedsReminders") } as const;
  }

  return {
    data: {
      label: parsed.data.label,
      requiresExpiry: parsed.data.requiresExpiry,
      defaultReminderOffsets: reminders,
      appliesTo,
    },
  } as const;
}

export async function createDocumentCategory(
  _previous: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const principal = await requirePermission("settings.manage");
  const t = await getTranslations("documentCategories");

  const result = await readForm(formData);
  if ("error" in result) return { error: result.error };

  try {
    await asActor(principal, async () => {
      await prisma.documentCategory.create({
        data: { ...result.data, key: slugify(result.data.label), isSystem: false },
      });
    });
  } catch (error) {
    return { error: await toUserMessage("createDocumentCategory", error) };
  }

  revalidatePath("/admin/document-categories");
  return { success: t("created", { name: result.data.label }) };
}

export async function updateDocumentCategory(
  categoryId: string,
  _previous: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const principal = await requirePermission("settings.manage");
  const t = await getTranslations("documentCategories");

  const result = await readForm(formData);
  if ("error" in result) return { error: result.error };

  const existing = await prisma.documentCategory.findUnique({ where: { id: categoryId } });
  if (!existing) {
    const te = await getTranslations("documentCategories.errors");
    return { error: te("notFound") };
  }

  try {
    // A seeded category is editable — §17 gives the client the wording and the schedule.
    // Only its removal is refused, below.
    await asActor(principal, async () => {
      await prisma.documentCategory.update({ where: { id: categoryId }, data: result.data });
    });
  } catch (error) {
    return { error: await toUserMessage("updateDocumentCategory", error) };
  }

  revalidatePath("/admin/document-categories");
  revalidatePath(`/admin/document-categories/${categoryId}`);
  return { success: t("updated") };
}

export async function deleteDocumentCategory(
  categoryId: string,
  _previous: CategoryFormState,
  _formData: FormData,
): Promise<CategoryFormState> {
  const principal = await requirePermission("settings.manage");
  const te = await getTranslations("documentCategories.errors");

  const category = await prisma.documentCategory.findUnique({ where: { id: categoryId } });
  if (!category) return { error: te("notFound") };
  if (category.isSystem) return { error: te("isSystem") };

  // Counted without excluding removed documents: the foreign key does not care that a
  // document is soft-deleted, and neither does the audit trail that points at it.
  const inUse = await prisma.document.count({ where: { categoryId } });
  if (inUse > 0) return { error: te("inUse", { count: inUse }) };

  try {
    await asActor(principal, async () => {
      await prisma.documentCategory.delete({ where: { id: categoryId } });
    });
  } catch (error) {
    return { error: await toUserMessage("deleteDocumentCategory", error) };
  }

  // Back to the list: staying on the detail page of a type that no longer exists leaves
  // the reader on a page that 404s the moment they refresh it.
  revalidatePath("/admin/document-categories");
  redirect("/admin/document-categories");
}
