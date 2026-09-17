"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { normaliseUaeMobile } from "@drivenx/core";
import { nextCustomerCode, prisma } from "@drivenx/db";

import { asActor, requirePermission } from "@/lib/auth";
import { toUserMessage } from "@/lib/log";

export interface CustomerFormState {
  error?: string;
  success?: string;
}

const PARTY_STATUSES = ["ACTIVE", "INACTIVE", "BLACKLISTED"] as const;

/**
 * Built per request so validation messages come out in the language on screen.
 *
 * The mobile number is normalised rather than merely checked: staff type `050 123 4567`,
 * `+971 50 123 4567` and `971501234567` for the same person, and storing them as typed
 * makes one customer look like three and global search miss two of them.
 */
async function customerSchema() {
  const t = await getTranslations("customers.errors");

  return z.object({
    fullName: z.string().trim().min(2, t("fullName")),
    mobile: z
      .string()
      .trim()
      .transform((value) => normaliseUaeMobile(value))
      .refine((value): value is string => value !== null, t("mobile")),
    email: z
      .union([z.literal(""), z.string().trim().toLowerCase().email(t("email"))])
      .transform((value) => (value === "" ? null : value)),
    dateOfBirth: z
      .union([z.literal(""), z.coerce.date()])
      .transform((value) => (value === "" ? null : value)),
    nationality: emptyToNull(),
    addressLine: emptyToNull(),
    city: emptyToNull(),
    emergencyName: emptyToNull(),
    emergencyPhone: emptyToNull(),
    notes: emptyToNull(),
  });
}

function emptyToNull() {
  return z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable();
}

function readForm(formData: FormData) {
  return {
    fullName: formData.get("fullName") ?? "",
    mobile: formData.get("mobile") ?? "",
    email: formData.get("email") ?? "",
    dateOfBirth: formData.get("dateOfBirth") ?? "",
    nationality: formData.get("nationality") ?? "",
    addressLine: formData.get("addressLine") ?? "",
    city: formData.get("city") ?? "",
    emergencyName: formData.get("emergencyName") ?? "",
    emergencyPhone: formData.get("emergencyPhone") ?? "",
    notes: formData.get("notes") ?? "",
  };
}

export async function createCustomer(
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const principal = await requirePermission("customer.create");

  const [schema, tc, t] = await Promise.all([
    customerSchema(),
    getTranslations("common"),
    getTranslations("customers"),
  ]);

  const parsed = schema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? tc("checkDetails") };
  }

  try {
    await asActor(principal, async () => {
      await prisma.customer.create({
        data: {
          ...parsed.data,
          code: await nextCustomerCode(),
          createdById: principal.id,
        },
      });
    });
  } catch (error) {
    return { error: await toUserMessage("createCustomer", error) };
  }

  revalidatePath("/customers");
  return { success: t("created", { name: parsed.data.fullName }) };
}

export async function updateCustomer(
  customerId: string,
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const principal = await requirePermission("customer.update");

  const [schema, tc, t, te] = await Promise.all([
    customerSchema(),
    getTranslations("common"),
    getTranslations("customers"),
    getTranslations("customers.errors"),
  ]);

  const parsed = schema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? tc("checkDetails") };
  }

  const existing = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) {
    return { error: te("notFound") };
  }

  try {
    await asActor(principal, async () => {
      await prisma.customer.update({ where: { id: customerId }, data: parsed.data });
    });
  } catch (error) {
    return { error: await toUserMessage("updateCustomer", error) };
  }

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  return { success: t("updated") };
}

export async function setCustomerStatus(customerId: string, formData: FormData): Promise<void> {
  const principal = await requirePermission("customer.update");

  const status = z.enum(PARTY_STATUSES).safeParse(formData.get("status"));
  if (!status.success) return;

  await asActor(principal, async () => {
    await prisma.customer.update({
      where: { id: customerId },
      data: { status: status.data },
    });
  });

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
}

/**
 * Soft delete. The row stays: a customer is referenced by contracts, payments and ledger
 * entries, and removing it would either orphan those or cascade away financial history.
 */
export async function deleteCustomer(customerId: string): Promise<void> {
  const principal = await requirePermission("customer.delete");

  await asActor(principal, async () => {
    await prisma.customer.update({
      where: { id: customerId },
      data: { deletedAt: new Date() },
    });
  });

  revalidatePath("/customers");
}
