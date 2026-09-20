"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import {
  businessDate,
  IllegalVehicleTransitionError,
  isIsoDate,
  isPlausibleModelYear,
  isUaeEmirate,
  isVehicleStatus,
  Money,
  normaliseChassisNumber,
  normalisePlate,
  ON_CONTRACT_STATUSES,
  type Fils,
} from "@drivenx/core";
import {
  cancelPolicy,
  changeVehicleStatus,
  ConcurrentVehicleChangeError,
  createPolicy,
  createVehicle,
  InsuranceRuleError,
  MileageRejectedError,
  prisma,
  recordMileage,
  VehicleNotFoundError,
  VehicleStatusManagedByContractError,
  type NewVehicle,
} from "@drivenx/db";

import { asActor, requirePermission } from "@/lib/auth";
import { toUserMessage } from "@/lib/log";

export interface VehicleFormState {
  error?: string;
  success?: string;
}

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const optional = (formData: FormData, name: string) => text(formData, name) || null;

/** "" is "not entered"; anything else must be a real, non-negative AED amount. */
function money(input: string): Fils | null | "invalid" {
  if (input === "") return null;
  try {
    const fils = Money.parse(input);
    return fils < 0n ? "invalid" : fils;
  } catch {
    return "invalid";
  }
}

type VehicleFields = Omit<NewVehicle, "currentMileageKm">;

/**
 * Everything the create and edit forms share. Returns the first problem as a translated
 * message, or the fields ready to write.
 */
async function readVehicleForm(
  formData: FormData,
): Promise<{ error: string } | { data: VehicleFields }> {
  const t = await getTranslations("vehicles.errors");

  const make = text(formData, "make");
  const model = text(formData, "model");
  if (!make) return { error: t("make") };
  if (!model) return { error: t("model") };

  const year = Number(text(formData, "year"));
  if (!isPlausibleModelYear(year)) return { error: t("year") };

  const plateEmirate = text(formData, "plateEmirate");
  const plate = normalisePlate(text(formData, "plateCode"), text(formData, "plateNumber"));
  if (!isUaeEmirate(plateEmirate) || !plate) return { error: t("plate") };

  const vin = normaliseChassisNumber(text(formData, "vin"));
  if (!vin) return { error: t("vin") };

  const ownershipType = text(formData, "ownershipType");
  if (ownershipType !== "COMPANY_OWNED" && ownershipType !== "B2B_SUPPLIER") {
    return { error: t("ownership") };
  }

  const purchasePrice = money(text(formData, "purchasePrice"));
  const monthlyCost = money(text(formData, "supplierMonthlyCost"));
  if (purchasePrice === "invalid" || monthlyCost === "invalid") return { error: t("money") };

  let supplierId: string | null = null;

  if (ownershipType === "B2B_SUPPLIER") {
    // A leased-in car with no supplier has nobody to pay; with no monthly cost it has no
    // cost to measure profit against. The database refuses the first as well.
    supplierId = optional(formData, "supplierId");
    if (!supplierId) return { error: t("supplierRequired") };
    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId, deletedAt: null },
      select: { id: true },
    });
    if (!supplier) return { error: t("supplierGone") };
    if (monthlyCost === null) return { error: t("monthlyCostRequired") };
  }

  const sourceDateText = text(formData, "sourceDate");
  const sourceDate = sourceDateText ? new Date(`${sourceDateText}T00:00:00Z`) : null;

  return {
    data: {
      make,
      model,
      year,
      variant: optional(formData, "variant"),
      colour: optional(formData, "colour"),
      plateEmirate,
      plateCode: plate.plateCode,
      plateNumber: plate.plateNumber,
      vin,
      ownershipType,
      supplierId,
      sourceDate,
      // Only the cost that applies to this kind of ownership is kept. A company car's
      // cost is what was paid for it; a leased car's is what is paid each month.
      purchasePriceFils: ownershipType === "COMPANY_OWNED" ? purchasePrice : null,
      supplierMonthlyCostFils: ownershipType === "B2B_SUPPLIER" ? monthlyCost : null,
      notes: optional(formData, "notes"),
    },
  };
}

/**
 * A duplicate VIN or plate, told apart from any other failure so the message is useful.
 *
 * Recognised by shape, not `instanceof`. The same unique violation is an instance of
 * PrismaClientKnownRequestError when thrown and checked inside @drivenx/db, yet this check
 * missed it in the web action and the user got "something went wrong" for a duplicate VIN
 * — most likely the generated client loaded twice in the bundle, so the class that threw
 * is not the class imported here. The error code does not depend on which copy threw it.
 */
async function duplicateMessage(error: unknown): Promise<string | null> {
  const candidate = error as { code?: unknown; meta?: { target?: unknown } } | null;
  if (typeof candidate !== "object" || candidate === null || candidate.code !== "P2002") {
    return null;
  }
  const t = await getTranslations("vehicles.errors");
  const target = JSON.stringify(candidate.meta?.target ?? "");
  if (target.includes("vin")) return t("vinTaken");
  if (target.includes("plate")) return t("plateTaken");
  return null;
}

export async function createVehicleAction(
  _previous: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const principal = await requirePermission("vehicle.create");
  const t = await getTranslations("vehicles.errors");

  const result = await readVehicleForm(formData);
  if ("error" in result) return { error: result.error };

  const mileage = Number(text(formData, "currentMileageKm") || "0");
  if (!Number.isInteger(mileage) || mileage < 0) return { error: t("mileage.notWholeNumber") };

  let vehicleId: string;
  try {
    const vehicle = await asActor(principal, () =>
      createVehicle({ ...result.data, currentMileageKm: mileage }, principal.id),
    );
    vehicleId = vehicle.id;
  } catch (error) {
    return { error: (await duplicateMessage(error)) ?? (await toUserMessage("createVehicle", error)) };
  }

  revalidatePath("/vehicles");
  redirect(`/vehicles/${vehicleId}`);
}

export async function updateVehicleAction(
  vehicleId: string,
  _previous: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const principal = await requirePermission("vehicle.update");
  const [t, tv] = await Promise.all([
    getTranslations("vehicles.errors"),
    getTranslations("vehicles"),
  ]);

  const result = await readVehicleForm(formData);
  if ("error" in result) return { error: result.error };

  const existing = await prisma.vehicle.findFirst({
    where: { id: vehicleId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!existing) return { error: t("notFound") };

  // Reclassifying a car as leased-in while it is on a plain rental, or after it has been
  // sold, would put it in a state the supplier rule forbids — by editing its ownership
  // rather than its status. Refused here for the same reason the status move is.
  if (
    result.data.ownershipType === "B2B_SUPPLIER" &&
    (existing.status === "RENTED" || existing.status === "SOLD")
  ) {
    return { error: t("ownershipConflict") };
  }

  try {
    // Status and mileage are not editable here: each has its own rules and its own
    // history, and a details form is the wrong place to change either quietly.
    await asActor(principal, () =>
      prisma.vehicle.update({ where: { id: vehicleId }, data: result.data }),
    );
  } catch (error) {
    return { error: (await duplicateMessage(error)) ?? (await toUserMessage("updateVehicle", error)) };
  }

  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${vehicleId}`);
  return { success: tv("updated") };
}

export async function changeVehicleStatusAction(
  vehicleId: string,
  _previous: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const principal = await requirePermission("vehicle.transition");
  const [t, tv, ts] = await Promise.all([
    getTranslations("vehicles.errors"),
    getTranslations("vehicles"),
    getTranslations("vehicles.status"),
  ]);

  const to = text(formData, "status");
  if (!isVehicleStatus(to)) return { error: t("chooseStatus") };

  try {
    await asActor(principal, () =>
      changeVehicleStatus(vehicleId, to, {
        reason: optional(formData, "reason"),
        actorId: principal.id,
      }),
    );
  } catch (error) {
    if (error instanceof IllegalVehicleTransitionError) {
      return {
        error: error.blockedByOwnership
          ? t("leasedOnlyLto")
          : t("illegalTransition", { from: ts(error.from), to: ts(error.to) }),
      };
    }
    if (error instanceof VehicleStatusManagedByContractError) return { error: t("contractManaged") };
    if (error instanceof ConcurrentVehicleChangeError) return { error: t("concurrent") };
    if (error instanceof VehicleNotFoundError) return { error: t("notFound") };
    return { error: await toUserMessage("changeVehicleStatus", error) };
  }

  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${vehicleId}`);
  return { success: tv("statusChanged", { status: ts(to) }) };
}

export async function recordMileageAction(
  vehicleId: string,
  _previous: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const principal = await requirePermission("vehicle.update");
  const [t, tv] = await Promise.all([
    getTranslations("vehicles.errors"),
    getTranslations("vehicles"),
  ]);

  const raw = text(formData, "readingKm").replace(/[,\s]/g, "");
  if (!/^\d+$/.test(raw)) return { error: t("mileage.notWholeNumber") };
  const readingKm = Number(raw);

  try {
    await asActor(principal, () =>
      recordMileage(vehicleId, readingKm, {
        note: optional(formData, "note"),
        actorId: principal.id,
      }),
    );
  } catch (error) {
    if (error instanceof MileageRejectedError) {
      return { error: t(`mileage.${error.code}`, error.params ?? {}) };
    }
    if (error instanceof ConcurrentVehicleChangeError) return { error: t("concurrent") };
    if (error instanceof VehicleNotFoundError) return { error: t("notFound") };
    return { error: await toUserMessage("recordMileage", error) };
  }

  revalidatePath(`/vehicles/${vehicleId}`);
  return { success: tv("mileageRecorded") };
}

export async function deleteVehicleAction(
  vehicleId: string,
  _previous: VehicleFormState,
  _formData: FormData,
): Promise<VehicleFormState> {
  const principal = await requirePermission("vehicle.delete");
  const t = await getTranslations("vehicles.errors");

  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, deletedAt: null },
    select: { status: true },
  });
  if (!vehicle) return { error: t("notFound") };

  // A car committed to a customer cannot quietly disappear from the fleet. Contracts
  // arrive in 1D; until then the status is the evidence of the commitment.
  if (ON_CONTRACT_STATUSES.includes(vehicle.status)) return { error: t("onContract") };

  try {
    await asActor(principal, () =>
      prisma.vehicle.update({ where: { id: vehicleId }, data: { deletedAt: new Date() } }),
    );
  } catch (error) {
    return { error: await toUserMessage("deleteVehicle", error) };
  }

  revalidatePath("/vehicles");
  redirect("/vehicles");
}

/** Every refusal the insurance service can give, worded for the reader. */
async function explainInsurance(error: unknown, operation: string): Promise<string> {
  const t = await getTranslations("insurance.errors");
  if (error instanceof InsuranceRuleError) return t(error.code);
  return toUserMessage(operation, error);
}

export async function addPolicyAction(
  vehicleId: string,
  _previous: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const principal = await requirePermission("insurance.manage");
  const [t, te] = await Promise.all([getTranslations("insurance"), getTranslations("insurance.errors")]);

  const premium = money(text(formData, "premium"));
  if (premium === "invalid" || premium === null) return { error: te("money") };

  const startDate = text(formData, "startDate");
  const expiryDate = text(formData, "expiryDate");
  if (!isIsoDate(startDate) || !isIsoDate(expiryDate)) return { error: te("dates") };

  const coverage = text(formData, "coverage") === "THIRD_PARTY" ? "THIRD_PARTY" : "COMPREHENSIVE";

  try {
    await asActor(principal, () =>
      createPolicy(
        {
          vehicleId,
          provider: text(formData, "provider"),
          policyNumber: text(formData, "policyNumber"),
          coverage,
          startDate,
          expiryDate,
          premiumNetFils: premium,
          notes: optional(formData, "notes"),
        },
        principal.id,
      ),
    );
  } catch (error) {
    return { error: await explainInsurance(error, "addPolicy") };
  }

  revalidatePath(`/vehicles/${vehicleId}`);
  return { success: t("added") };
}

export async function cancelPolicyAction(
  vehicleId: string,
  policyId: string,
  _previous: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const principal = await requirePermission("insurance.manage");
  const [t, te] = await Promise.all([getTranslations("insurance"), getTranslations("insurance.errors")]);

  const refund = money(text(formData, "refund"));
  if (refund === "invalid") return { error: te("money") };

  try {
    await asActor(principal, () =>
      cancelPolicy(policyId, {
        reason: text(formData, "reason"),
        refundFils: refund,
        actorId: principal.id,
        today: businessDate(new Date()),
      }),
    );
  } catch (error) {
    return { error: await explainInsurance(error, "cancelPolicy") };
  }

  revalidatePath(`/vehicles/${vehicleId}`);
  return { success: t("cancel.cancelled") };
}
