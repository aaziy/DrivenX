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
  type DamageSeverity,
  type Fils,
  type VehiclePanel,
} from "@drivenx/core";
import {
  activateContract,
  addDamagePoint,
  addSettlementLine,
  ContractRuleError,
  discardHandover,
  HandoverRuleError,
  recordHandover,
  removeDamagePoint,
  signHandover,
  openSettlement,
  removeSettlementLine,
  settleSettlement,
  SettlementRuleError,
  terminateContract,
  createContract,
  prisma,
  recordPayment,
  recordSupplierPayment,
  SupplierInvoiceRuleError,
  waiveInstallment,
  type NewContract,
  type NewDamagePoint,
} from "@drivenx/db";

import { buildObjectKey, validateUpload } from "@drivenx/storage";

import { asActor, requirePermission } from "@/lib/auth";
import { toUserMessage } from "@/lib/log";
import { maxUploadBytes, storage } from "@/lib/storage";

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

/** Every refusal the settlement service can give, worded for the reader. */
async function explainSettlement(error: unknown, operation: string): Promise<string> {
  const t = await getTranslations("settlements.errors");
  if (error instanceof SettlementRuleError) return t(error.code);
  if (error instanceof IllegalVehicleTransitionError) {
    const ts = await getTranslations("vehicles.status");
    const tc = await getTranslations("contracts.errors");
    return tc("vehicleNotAvailable", { status: ts(error.from) });
  }
  if (error instanceof IllegalContractTransitionError) {
    const ts = await getTranslations("contracts.status");
    const tc = await getTranslations("contracts.errors");
    return tc("illegalTransition", { from: ts(error.from), to: ts(error.to) });
  }
  return toUserMessage(operation, error);
}

const SETTLEMENT_REASONS = ["EARLY_TERMINATION", "END_OF_TERM", "RETURN"] as const;
const SETTLEMENT_CHARGE_TYPES = ["EXCESS_MILEAGE", "DAMAGE", "FEE", "OTHER"] as const;

export async function openSettlementAction(
  contractId: string,
  _previous: ContractFormState,
  formData: FormData,
): Promise<ContractFormState> {
  const principal = await requirePermission("contract.cancel");
  const te = await getTranslations("settlements.errors");

  const reason = text(formData, "reason");
  const mileageText = text(formData, "returnedMileageKm");
  const mileage = mileageText === "" ? null : Number(mileageText);
  if (mileage !== null && (!Number.isInteger(mileage) || mileage < 0)) return { error: te("mileage") };

  try {
    await asActor(principal, () =>
      openSettlement(contractId, {
        reason: (SETTLEMENT_REASONS as readonly string[]).includes(reason)
          ? (reason as (typeof SETTLEMENT_REASONS)[number])
          : "RETURN",
        returnedMileageKm: mileage,
        actorId: principal.id,
      }),
    );
  } catch (error) {
    return { error: await explainSettlement(error, "openSettlement") };
  }
  revalidatePath(`/contracts/${contractId}`);
  return {};
}

export async function addSettlementLineAction(
  contractId: string,
  settlementId: string,
  _previous: ContractFormState,
  formData: FormData,
): Promise<ContractFormState> {
  const principal = await requirePermission("contract.cancel");
  const te = await getTranslations("settlements.errors");

  const amount = money(text(formData, "amount"));
  if (amount === "invalid" || amount === null || amount === 0n) return { error: te("invalidLine") };
  const chargeType = text(formData, "chargeType");

  try {
    await asActor(principal, () =>
      addSettlementLine(
        settlementId,
        {
          kind: text(formData, "kind") === "CREDIT" ? "CREDIT" : "CHARGE",
          chargeType: (SETTLEMENT_CHARGE_TYPES as readonly string[]).includes(chargeType)
            ? (chargeType as (typeof SETTLEMENT_CHARGE_TYPES)[number])
            : "OTHER",
          label: text(formData, "label"),
          netFils: amount,
        },
        principal.id,
      ),
    );
  } catch (error) {
    return { error: await explainSettlement(error, "addSettlementLine") };
  }
  revalidatePath(`/contracts/${contractId}`);
  return {};
}

export async function removeSettlementLineAction(
  contractId: string,
  lineId: string,
  _previous: ContractFormState,
  _formData: FormData,
): Promise<ContractFormState> {
  const principal = await requirePermission("contract.cancel");
  try {
    await asActor(principal, () => removeSettlementLine(lineId));
  } catch (error) {
    return { error: await explainSettlement(error, "removeSettlementLine") };
  }
  revalidatePath(`/contracts/${contractId}`);
  return {};
}

export async function settleSettlementAction(
  contractId: string,
  settlementId: string,
  _previous: ContractFormState,
  _formData: FormData,
): Promise<ContractFormState> {
  const principal = await requirePermission("contract.cancel");
  try {
    await asActor(principal, () =>
      settleSettlement(settlementId, { actorId: principal.id, today: businessDate(new Date()) }),
    );
  } catch (error) {
    return { error: await explainSettlement(error, "settleSettlement") };
  }
  revalidatePath(`/contracts/${contractId}`);
  return {};
}

export async function terminateContractAction(
  contractId: string,
  _previous: ContractFormState,
  formData: FormData,
): Promise<ContractFormState> {
  const principal = await requirePermission("contract.cancel");
  const t = await getTranslations("settlements");

  const outcome = text(formData, "outcome") === "END_OF_TERM" ? "END_OF_TERM" : "EARLY_TERMINATION";
  const vehicleTo = text(formData, "vehicleTo") === "SOLD" ? "SOLD" : "RETURNED";

  try {
    await asActor(principal, () =>
      terminateContract(contractId, { outcome, vehicleTo, actorId: principal.id, today: businessDate(new Date()) }),
    );
  } catch (error) {
    return { error: await explainSettlement(error, "terminateContract") };
  }
  revalidatePath(`/contracts/${contractId}`);
  revalidatePath("/contracts");
  return { success: t("ended") };
}

// ---------------------------------------------------------------------------
// Handover and return (P2-01 – P2-03, SOW §12)
// ---------------------------------------------------------------------------

async function explainHandover(error: unknown, operation: string): Promise<string> {
  const t = await getTranslations("handovers.errors");
  if (error instanceof HandoverRuleError) return t(error.code);
  return toUserMessage(operation, error);
}

const SEVERITIES = ["MINOR", "MODERATE", "SEVERE"] as const;

function severityFrom(value: string): DamageSeverity {
  return (SEVERITIES as readonly string[]).includes(value) ? (value as DamageSeverity) : "MINOR";
}

/** A coordinate the diagram sent back: a fraction of the picture, or nothing at all. */
function fraction(value: string): number | null {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

/**
 * The marks made while the form was being filled in, as the client sent them.
 *
 * Nothing here is trusted: the panel is re-derived from the position by the domain layer,
 * and anything that is not a mark is dropped rather than half-read.
 */
function parseDamagePoints(raw: string): NewDamagePoint[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry): NewDamagePoint[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const x = typeof record["positionX"] === "number" ? record["positionX"] : null;
    const y = typeof record["positionY"] === "number" ? record["positionY"] : null;
    return [
      {
        panel: typeof record["panel"] === "string" ? (record["panel"] as VehiclePanel) : undefined,
        severity: severityFrom(typeof record["severity"] === "string" ? record["severity"] : ""),
        positionX: x,
        positionY: y,
        note: typeof record["note"] === "string" ? record["note"] : null,
      },
    ];
  });
}

export async function recordHandoverAction(
  contractId: string,
  _previous: ContractFormState,
  formData: FormData,
): Promise<ContractFormState> {
  const principal = await requirePermission("handover.manage");
  const te = await getTranslations("handovers.errors");

  const type = text(formData, "type") === "RETURN" ? "RETURN" : "HANDOVER";
  const occurredAt = new Date(text(formData, "occurredAt"));
  if (Number.isNaN(occurredAt.getTime())) return { error: te("occurredAt") };

  const odometerKm = Number(text(formData, "odometerKm"));
  if (!Number.isInteger(odometerKm) || odometerKm < 0) return { error: te("odometer") };

  const fuelEighths = Number(text(formData, "fuelEighths"));

  try {
    await asActor(principal, () =>
      recordHandover(
        {
          contractId,
          type,
          occurredAt,
          odometerKm,
          fuelEighths,
          conditionNotes: text(formData, "conditionNotes") || null,
          damagePoints: parseDamagePoints(text(formData, "damagePoints")),
        },
        principal.id,
      ),
    );
  } catch (error) {
    return { error: await explainHandover(error, "recordHandover") };
  }
  revalidatePath(`/contracts/${contractId}`);
  return {};
}

export async function addDamagePointAction(
  contractId: string,
  handoverId: string,
  _previous: ContractFormState,
  formData: FormData,
): Promise<ContractFormState> {
  const principal = await requirePermission("handover.manage");
  const te = await getTranslations("handovers.errors");

  const positionX = fraction(text(formData, "positionX"));
  const positionY = fraction(text(formData, "positionY"));
  const panel = text(formData, "panel");
  if (!panel) return { error: te("invalidDamagePoint") };

  try {
    await asActor(principal, () =>
      addDamagePoint(
        handoverId,
        {
          panel: panel as VehiclePanel,
          severity: severityFrom(text(formData, "severity")),
          positionX,
          positionY,
          note: text(formData, "note") || null,
        },
        principal.id,
      ),
    );
  } catch (error) {
    return { error: await explainHandover(error, "addDamagePoint") };
  }
  revalidatePath(`/contracts/${contractId}`);
  return {};
}

export async function removeDamagePointAction(
  contractId: string,
  damagePointId: string,
  _previous: ContractFormState,
  _formData: FormData,
): Promise<ContractFormState> {
  const principal = await requirePermission("handover.manage");
  try {
    await asActor(principal, () => removeDamagePoint(damagePointId));
  } catch (error) {
    return { error: await explainHandover(error, "removeDamagePoint") };
  }
  revalidatePath(`/contracts/${contractId}`);
  return {};
}

export async function discardHandoverAction(
  contractId: string,
  handoverId: string,
  _previous: ContractFormState,
  _formData: FormData,
): Promise<ContractFormState> {
  const principal = await requirePermission("handover.manage");
  try {
    await asActor(principal, () => discardHandover(handoverId));
  } catch (error) {
    return { error: await explainHandover(error, "discardHandover") };
  }
  revalidatePath(`/contracts/${contractId}`);
  return {};
}

/**
 * A signature drawn in the browser, put in storage like any other upload.
 *
 * The data URL's own claim about its type is ignored: the bytes are sniffed, size-checked
 * and stored under the same rules as a passport scan, because "it came from our own
 * canvas" is an assumption about the browser rather than about the request.
 */
async function storeSignature(handoverId: string, dataUrl: string): Promise<string | null> {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) return null;

  const bytes = new Uint8Array(Buffer.from(dataUrl.slice(comma + 1), "base64"));
  const validation = validateUpload(
    { fileName: `signature-${handoverId}.png`, bytes },
    { maxBytes: maxUploadBytes() },
  );
  if (!validation.valid) return null;

  const key = buildObjectKey("signature", handoverId, validation.mimeType);
  await storage().put({ key, bytes, mimeType: validation.mimeType, fileName: validation.fileName });
  return key;
}

export async function signHandoverAction(
  contractId: string,
  handoverId: string,
  _previous: ContractFormState,
  formData: FormData,
): Promise<ContractFormState> {
  const principal = await requirePermission("handover.manage");
  const te = await getTranslations("handovers.errors");

  const customerSignatureName = text(formData, "customerSignatureName");
  const staffSignatureName = text(formData, "staffSignatureName");
  if (!customerSignatureName || !staffSignatureName) return { error: te("signatureIncomplete") };

  const customerDrawing = text(formData, "customerSignature");
  const staffDrawing = text(formData, "staffSignature");
  if (!customerDrawing || !staffDrawing) return { error: te("signatureMissing") };

  let customerSignatureKey: string | null;
  let staffSignatureKey: string | null;
  try {
    // Both uploads before the write: a form that signed with one signature in storage and
    // the other lost to a network error is exactly what the rule below forbids.
    [customerSignatureKey, staffSignatureKey] = await Promise.all([
      storeSignature(handoverId, customerDrawing),
      storeSignature(handoverId, staffDrawing),
    ]);
  } catch (error) {
    return { error: await toUserMessage("storeSignature", error) };
  }
  if (!customerSignatureKey || !staffSignatureKey) return { error: te("signatureMissing") };

  try {
    await asActor(principal, () =>
      signHandover(
        handoverId,
        { customerSignatureKey, customerSignatureName, staffSignatureKey, staffSignatureName },
        principal.id,
      ),
    );
  } catch (error) {
    return { error: await explainHandover(error, "signHandover") };
  }
  revalidatePath(`/contracts/${contractId}`);
  // No success message: signing replaces the form with the signed record, so a message
  // returned here would be rendered by a form that no longer exists. The badge is the
  // evidence, as it is for contract activation.
  return {};
}
