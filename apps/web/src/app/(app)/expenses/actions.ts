"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import {
  EXPENSE_ALLOCATIONS,
  EXPENSE_CATEGORIES,
  isIsoDate,
  Money,
  type ExpenseAllocation,
  type ExpenseCategory,
  type Fils,
} from "@drivenx/core";
import { ExpenseRuleError, recordExpense } from "@drivenx/db";

import { asActor, requirePermission } from "@/lib/auth";
import { toUserMessage } from "@/lib/log";

export interface ExpenseFormState {
  error?: string;
  success?: string;
}

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const optional = (formData: FormData, name: string) => text(formData, name) || null;

function money(input: string): Fils | null | "invalid" {
  if (input === "") return null;
  try {
    const fils = Money.parse(input);
    return fils < 0n ? "invalid" : fils;
  } catch {
    return "invalid";
  }
}

export async function recordExpenseAction(
  _previous: ExpenseFormState,
  formData: FormData,
): Promise<ExpenseFormState> {
  const principal = await requirePermission("expense.manage");
  const [t, te] = await Promise.all([getTranslations("expenses"), getTranslations("expenses.errors")]);

  const amount = money(text(formData, "amount"));
  if (amount === "invalid" || amount === null) return { error: te("money") };

  const incurredOn = text(formData, "incurredOn");
  if (!isIsoDate(incurredOn)) return { error: te("date") };

  const category = text(formData, "category");
  const allocation = text(formData, "allocation");
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(category)) return { error: te("invalidExpense") };
  if (!(EXPENSE_ALLOCATIONS as readonly string[]).includes(allocation)) return { error: te("invalidExpense") };

  // Blank means "whatever this kind of cost normally carries", which the service decides.
  const vatText = text(formData, "vatBasisPoints");

  try {
    await asActor(principal, () =>
      recordExpense(
        {
          category: category as ExpenseCategory,
          allocation: allocation as ExpenseAllocation,
          vehicleId: optional(formData, "vehicleId"),
          contractId: optional(formData, "contractId"),
          incurredOn,
          description: text(formData, "description"),
          supplierName: optional(formData, "supplierName"),
          referenceNumber: optional(formData, "referenceNumber"),
          netFils: amount,
          ...(vatText === "" ? {} : { vatBasisPoints: Number(vatText) }),
          notes: optional(formData, "notes"),
        },
        principal.id,
      ),
    );
  } catch (error) {
    if (error instanceof ExpenseRuleError) return { error: te(error.code) };
    return { error: await toUserMessage("recordExpense", error) };
  }

  revalidatePath("/expenses");
  return { success: t("added") };
}
