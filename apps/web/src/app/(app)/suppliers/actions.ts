"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { isValidIban, isValidTrn } from "@drivenx/core";
import { nextSupplierCode, prisma } from "@drivenx/db";

import { asActor, requirePermission } from "@/lib/auth";
import { toUserMessage } from "@/lib/log";

export interface SupplierFormState {
  error?: string;
  success?: string;
}

const PARTY_STATUSES = ["ACTIVE", "INACTIVE", "BLACKLISTED"] as const;

/**
 * A supplier's number is often a landline (04 123 4567) or an overseas office, so this
 * deliberately does not use the UAE mobile rules that customers get. It only strips the
 * formatting and insists on enough digits to be a phone number at all.
 */
function normalisePhone(value: string): string | null {
  const cleaned = value.replace(/[^\d+]/g, "");
  return cleaned.replace(/\D/g, "").length >= 7 ? cleaned : null;
}

function optionalText() {
  return z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value));
}

async function supplierSchema() {
  const t = await getTranslations("suppliers.errors");

  return z.object({
    companyName: z.string().trim().min(2, t("companyName")),
    contactPerson: optionalText(),
    // Stored stripped of formatting, not as typed: the list searches phone numbers by
    // digits, and "3217654" can never match a stored "04 321 7654".
    phone: optionalText()
      .refine((value) => value === null || normalisePhone(value) !== null, t("phone"))
      .transform((value) => (value === null ? null : normalisePhone(value))),
    email: z
      .union([z.literal(""), z.string().trim().toLowerCase().email(t("email"))])
      .transform((value) => (value === "" ? null : value)),
    address: optionalText(),
    tradeLicenseNo: optionalText(),
    // A wrong TRN makes every tax invoice to this supplier wrong, so it is checked on
    // the way in rather than discovered at filing.
    trn: optionalText()
      .transform((value) => (value === null ? null : value.replace(/\s/g, "")))
      .refine((value) => value === null || isValidTrn(value), t("trn")),
    bankName: optionalText(),
    bankAccountName: optionalText(),
    // A mistyped IBAN is a payment that fails weeks later, by which point nobody
    // remembers typing it. The check digits catch it now.
    iban: optionalText()
      .transform((value) => (value === null ? null : value.replace(/\s/g, "").toUpperCase()))
      .refine((value) => value === null || isValidIban(value), t("iban")),
    notes: optionalText(),
  });
}

function readForm(formData: FormData) {
  const field = (name: string) => formData.get(name) ?? "";

  return {
    companyName: field("companyName"),
    contactPerson: field("contactPerson"),
    phone: field("phone"),
    email: field("email"),
    address: field("address"),
    tradeLicenseNo: field("tradeLicenseNo"),
    trn: field("trn"),
    bankName: field("bankName"),
    bankAccountName: field("bankAccountName"),
    iban: field("iban"),
    notes: field("notes"),
  };
}

export async function createSupplier(
  _previous: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const principal = await requirePermission("supplier.create");

  const [schema, tc, t] = await Promise.all([
    supplierSchema(),
    getTranslations("common"),
    getTranslations("suppliers"),
  ]);

  const parsed = schema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? tc("checkDetails") };
  }

  try {
    await asActor(principal, async () => {
      await prisma.supplier.create({
        data: {
          ...parsed.data,
          code: await nextSupplierCode(),
          createdById: principal.id,
        },
      });
    });
  } catch (error) {
    return { error: await toUserMessage("createSupplier", error) };
  }

  revalidatePath("/suppliers");
  return { success: t("created", { name: parsed.data.companyName }) };
}

export async function updateSupplier(
  supplierId: string,
  _previous: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const principal = await requirePermission("supplier.update");

  const [schema, tc, t, te] = await Promise.all([
    supplierSchema(),
    getTranslations("common"),
    getTranslations("suppliers"),
    getTranslations("suppliers.errors"),
  ]);

  const parsed = schema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? tc("checkDetails") };
  }

  const existing = await prisma.supplier.findFirst({
    where: { id: supplierId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) {
    return { error: te("notFound") };
  }

  try {
    await asActor(principal, async () => {
      await prisma.supplier.update({ where: { id: supplierId }, data: parsed.data });
    });
  } catch (error) {
    return { error: await toUserMessage("updateSupplier", error) };
  }

  revalidatePath("/suppliers");
  revalidatePath(`/suppliers/${supplierId}`);
  return { success: t("updated") };
}

export async function setSupplierStatus(supplierId: string, formData: FormData): Promise<void> {
  const principal = await requirePermission("supplier.update");

  const status = z.enum(PARTY_STATUSES).safeParse(formData.get("status"));
  if (!status.success) return;

  await asActor(principal, async () => {
    await prisma.supplier.update({ where: { id: supplierId }, data: { status: status.data } });
  });

  revalidatePath("/suppliers");
  revalidatePath(`/suppliers/${supplierId}`);
}

/**
 * Soft delete. Vehicles, contracts and payables reference this supplier; removing the
 * row would orphan them or cascade away purchase history.
 */
export async function deleteSupplier(supplierId: string): Promise<void> {
  const principal = await requirePermission("supplier.delete");

  await asActor(principal, async () => {
    await prisma.supplier.update({
      where: { id: supplierId },
      data: { deletedAt: new Date() },
    });
  });

  revalidatePath("/suppliers");
}
