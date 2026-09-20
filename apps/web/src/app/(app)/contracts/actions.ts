"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import {
  businessDate,
  IllegalContractTransitionError,
  IllegalVehicleTransitionError,
  InvalidPaymentError,
  isIsoDate,
  Money,
  type Fils,
} from "@drivenx/core";
import {
  activateContract,
  ContractRuleError,
  createContract,
  prisma,
  recordPayment,
  recordSupplierPayment,
  SupplierInvoiceRuleError,
  waiveInstallment,
  type NewContract,
} from "@drivenx/db";

import { asActor, requirePermission } from "@/lib/auth";
import { toUserMessage } from "@/lib/log";

export interface ContractFormState {
  error?: string;
  success?: string;
}

const CONTRACT_TYPES = ["LONG_TERM_RENTAL", "LEASE_TO_OWN", "B2B_RENTAL", "OTHER"] as const;
const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CARD", "TAMARA", "TABBY", "OTHER"] as const;

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

/** "" is nothing entered; otherwise a real, non-negative AED amount, or "invalid". */
function money(input: string): Fils | null | "invalid" {
  if (input === "") return null;
  try {
    const fils = Money.parse(input);
    return fils < 0n ? "invalid" : fils;
  } catch {
    return "invalid";
  }
}

/** Every refusal the contract service can give, as a sentence in the reader's language. */
async function explain(error: unknown, operation: string): Promise<string> {
  const t = await getTranslations("contracts.errors");
  if (error instanceof ContractRuleError) return t(error.code);
  if (error instanceof IllegalVehicleTransitionError) {
    const ts = await getTranslations("vehicles.status");
    return error.blockedByOwnership ? t("leasedCarNotLeaseToOwn") : t("vehicleNotAvailable", { status: ts(error.from) });
  }
  if (error instanceof IllegalContractTransitionError) {
    const ts = await getTranslations("contracts.status");
    return t("illegalTransition", { from: ts(error.from), to: ts(error.to) });
  }
  if (error instanceof InvalidPaymentError) return t("invalidPayment");
  if (error instanceof SupplierInvoiceRuleError) {
    const ts = await getTranslations("contracts.supplier.errors");
    return ts(error.code);
  }
  return toUserMessage(operation, error);
}

export async function createContractAction(
  _previous: ContractFormState,
  formData: FormData,
): Promise<ContractFormState> {
  const principal = await requirePermission("contract.create");
  const t = await getTranslations("contracts.errors");

  const type = text(formData, "type");
  const startDate = text(formData, "startDate");
  const durationMonths = Number(text(formData, "durationMonths"));
  const customerId = text(formData, "customerId");
  const vehicleId = text(formData, "vehicleId");

  if (!customerId) return { error: t("chooseCustomer") };
  if (!vehicleId) return { error: t("chooseVehicle") };
  if (!(CONTRACT_TYPES as readonly string[]).includes(type)) return { error: t("chooseType") };
  if (!isIsoDate(startDate)) return { error: t("startDate") };
  if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 120) {
    return { error: t("duration") };
  }

  const rental = money(text(formData, "monthlyRental"));
  const down = money(text(formData, "downPayment"));
  const insurance = money(text(formData, "annualInsurance"));
  const buyout = type === "LEASE_TO_OWN" ? money(text(formData, "buyout")) : null;
  const excessRate = money(text(formData, "excessMileageRate"));
  if ([rental, down, insurance, buyout, excessRate].includes("invalid")) return { error: t("money") };
  if (rental === null) return { error: t("rentalRequired") };

  const allowanceText = text(formData, "mileageAllowanceKm").replace(/[,\s]/g, "");
  if (allowanceText !== "" && !/^\d+$/.test(allowanceText)) return { error: t("allowance") };

  const input: NewContract = {
    customerId,
    vehicleId,
    type: type as NewContract["type"],
    startDate,
    durationMonths,
    monthlyRentalFils: rental as Fils,
    downPaymentFils: (down as Fils | null) ?? 0n,
    annualInsuranceFils: (insurance as Fils | null) ?? 0n,
    buyoutFils: (buyout as Fils | null) ?? 0n,
    mileageAllowanceKm: allowanceText === "" ? null : Number(allowanceText),
    excessMileageRateFils: excessRate as Fils | null,
    terms: text(formData, "terms") || null,
  };

  let contractId: string;
  try {
    const created = await asActor(principal, () => createContract(input, principal.id));
    contractId = created.id;
  } catch (error) {
    return { error: await explain(error, "createContract") };
  }

  revalidatePath("/contracts");
  redirect(`/contracts/${contractId}`);
}

export async function activateContractAction(
  contractId: string,
  _previous: ContractFormState,
  _formData: FormData,
): Promise<ContractFormState> {
  const principal = await requirePermission("contract.activate");
  const t = await getTranslations("contracts");

  try {
    const result = await asActor(principal, () =>
      // Today in Dubai, not on the server's clock — a contract activated at 1am local
      // time must not be issued as if it were yesterday.
      activateContract(contractId, { actorId: principal.id, today: businessDate(new Date()) }),
    );
    revalidatePath("/contracts");
    revalidatePath(`/contracts/${contractId}`);
    return { success: t("activated", { installments: result.installments, issued: result.issued }) };
  } catch (error) {
    return { error: await explain(error, "activateContract") };
  }
}

export async function recordPaymentAction(
  contractId: string,
  _previous: ContractFormState,
  formData: FormData,
): Promise<ContractFormState> {
  const principal = await requirePermission("payment.record");
  const [t, tc] = await Promise.all([getTranslations("contracts.errors"), getTranslations("contracts")]);

  const amount = money(text(formData, "amount"));
  if (amount === null || amount === "invalid" || amount === 0n) return { error: t("invalidPayment") };

  const receivedOn = text(formData, "receivedOn");
  if (!isIsoDate(receivedOn)) return { error: t("receivedOn") };

  const method = text(formData, "method");
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) return { error: t("method") };

  try {
    const result = await asActor(principal, () =>
      recordPayment(
        contractId,
        {
          amountFils: amount,
          receivedOn,
          method: method as (typeof PAYMENT_METHODS)[number],
          reference: text(formData, "reference") || null,
          notes: text(formData, "notes") || null,
        },
        { actorId: principal.id, today: businessDate(new Date()) },
      ),
    );
    revalidatePath(`/contracts/${contractId}`);
    return {
      success:
        result.creditFils > 0n
          ? tc("paymentRecordedWithCredit", { credit: Money.format(result.creditFils) })
          : tc("paymentRecorded"),
    };
  } catch (error) {
    return { error: await explain(error, "recordPayment") };
  }
}

export async function waiveInstallmentAction(
  contractId: string,
  installmentId: string,
  _previous: ContractFormState,
  formData: FormData,
): Promise<ContractFormState> {
  const principal = await requirePermission("payment.waive");
  const t = await getTranslations("contracts");

  try {
    await asActor(principal, () =>
      waiveInstallment(installmentId, {
        reason: text(formData, "reason"),
        actorId: principal.id,
        today: businessDate(new Date()),
      }),
    );
    revalidatePath(`/contracts/${contractId}`);
    return { success: t("waived") };
  } catch (error) {
    return { error: await explain(error, "waiveInstallment") };
  }
}

/** A payment out to the supplier of a leased-in car, against one of its invoices. */
export async function recordSupplierPaymentAction(
  contractId: string,
  _previous: ContractFormState,
  formData: FormData,
): Promise<ContractFormState> {
  const principal = await requirePermission("supplier_invoice.manage");
  const [t, tc, ts] = await Promise.all([
    getTranslations("contracts.errors"),
    getTranslations("contracts"),
    getTranslations("contracts.supplier.errors"),
  ]);

  const invoiceId = text(formData, "invoiceId");
  if (!invoiceId) return { error: ts("chooseInvoice") };

  const amount = money(text(formData, "amount"));
  if (amount === null || amount === "invalid" || amount === 0n) return { error: ts("invalidPayment") };

  const paidOn = text(formData, "paidOn");
  if (!isIsoDate(paidOn)) return { error: t("receivedOn") };

  const method = text(formData, "method");
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) return { error: t("method") };

  // The invoice must belong to this contract, so a doctored form cannot pay another one.
  const owned = await prisma.supplierInvoice.count({ where: { id: invoiceId, contractId } });
  if (owned === 0) return { error: ts("invoiceNotFound") };

  try {
    await asActor(principal, () =>
      recordSupplierPayment(
        invoiceId,
        {
          amountFils: amount,
          paidOn,
          method: method as (typeof PAYMENT_METHODS)[number],
          reference: text(formData, "reference") || null,
        },
        { actorId: principal.id, today: businessDate(new Date()) },
      ),
    );
    revalidatePath(`/contracts/${contractId}`);
    return { success: tc("supplier.recorded") };
  } catch (error) {
    return { error: await explain(error, "recordSupplierPayment") };
  }
}
