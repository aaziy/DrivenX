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
  IllegalAccidentTransitionError,
  IllegalClaimTransitionError,
  IllegalFineTransitionError,
  type AccidentStatus,
  type ClaimStatus,
  type FineStatus,
} from "@drivenx/core";
import {
  cancelPolicy,
  changeVehicleStatus,
  ConcurrentVehicleChangeError,
  createPolicy,
  createVehicle,
  InsuranceRuleError,
  MaintenanceRuleError,
  recordMaintenance,
  MileageRejectedError,
  prisma,
  recordMileage,
  VehicleNotFoundError,
  VehicleStatusManagedByContractError,
  type NewVehicle,
  AccidentRuleError,
  FineRuleError,
  lodgeClaim,
  recordAccident,
  recordFine,
  recordRepair,
  recoverFine,
  transitionAccident,
  transitionClaim,
  transitionFine,
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

const MAINTENANCE_TYPES = ["SERVICE", "REPAIR", "TYRES", "INSPECTION", "BODYWORK", "OTHER"] as const;

export async function recordMaintenanceAction(
  vehicleId: string,
  _previous: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const principal = await requirePermission("maintenance.manage");
  const [t, te] = await Promise.all([getTranslations("maintenance"), getTranslations("maintenance.errors")]);

  const cost = money(text(formData, "cost"));
  if (cost === "invalid") return { error: te("money") };

  const servicedOn = text(formData, "servicedOn");
  if (!isIsoDate(servicedOn)) return { error: te("date") };

  const odometer = Number(text(formData, "odometerKm"));
  if (!Number.isInteger(odometer) || odometer < 0) return { error: te("mileage") };

  const nextServiceOn = text(formData, "nextServiceOn");
  const nextKmText = text(formData, "nextServiceKm");
  const nextServiceKm = nextKmText === "" ? null : Number(nextKmText);
  if (nextServiceKm !== null && (!Number.isInteger(nextServiceKm) || nextServiceKm < 0)) {
    return { error: te("mileage") };
  }
  const type = text(formData, "type");

  try {
    await asActor(principal, () =>
      recordMaintenance(
        {
          vehicleId,
          type: (MAINTENANCE_TYPES as readonly string[]).includes(type)
            ? (type as (typeof MAINTENANCE_TYPES)[number])
            : "SERVICE",
          servicedOn,
          odometerKm: odometer,
          vendor: text(formData, "vendor"),
          vendorInvoiceNumber: optional(formData, "vendorInvoiceNumber"),
          description: optional(formData, "description"),
          costNetFils: cost ?? 0n,
          nextServiceOn: isIsoDate(nextServiceOn) ? nextServiceOn : null,
          nextServiceKm,
        },
        principal.id,
      ),
    );
  } catch (error) {
    const tm = await getTranslations("maintenance.errors");
    if (error instanceof MaintenanceRuleError) return { error: tm(error.code) };
    return { error: await toUserMessage("recordMaintenance", error) };
  }

  revalidatePath(`/vehicles/${vehicleId}`);
  return { success: t("added") };
}

// ---------------------------------------------------------------------------
// Traffic fines (P2-07, P2-08, SOW §13)
// ---------------------------------------------------------------------------

async function explainFine(error: unknown, operation: string): Promise<string> {
  const t = await getTranslations("fines.errors");
  if (error instanceof FineRuleError) return t(error.code);
  if (error instanceof IllegalFineTransitionError) {
    const ts = await getTranslations("fines.status");
    return t("illegalTransition", { from: ts(error.from), to: ts(error.to) });
  }
  return toUserMessage(operation, error);
}

export async function recordFineAction(
  vehicleId: string,
  _previous: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const principal = await requirePermission("fine.manage");
  const [t, te] = await Promise.all([getTranslations("fines"), getTranslations("fines.errors")]);

  const amount = money(text(formData, "amount"));
  if (amount === "invalid" || amount === null || amount === 0n) return { error: te("amount") };

  const occurredOn = text(formData, "occurredOn");
  if (!isIsoDate(occurredOn)) return { error: te("date") };
  const issuedOn = text(formData, "issuedOn");

  const payer = text(formData, "payer");

  try {
    await asActor(principal, () =>
      recordFine(
        {
          vehicleId,
          fineNumber: text(formData, "fineNumber"),
          authority: text(formData, "authority"),
          occurredOn,
          issuedOn: isIsoDate(issuedOn) ? issuedOn : null,
          amountFils: amount,
          // Blank means "whatever the offence date implies", which the service works out.
          ...(payer === "CUSTOMER" || payer === "COMPANY" ? { payer } : {}),
          notes: optional(formData, "notes"),
        },
        principal.id,
      ),
    );
  } catch (error) {
    return { error: await explainFine(error, "recordFine") };
  }

  revalidatePath(`/vehicles/${vehicleId}`);
  return { success: t("added") };
}

export async function transitionFineAction(
  vehicleId: string,
  fineId: string,
  to: FineStatus,
  _previous: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const principal = await requirePermission("fine.manage");

  // Paying needs the day the money left; the rest is today's decision.
  const paidOnField = text(formData, "paidOn");
  const paidOn = isIsoDate(paidOnField) ? paidOnField : businessDate(new Date());

  try {
    await asActor(principal, () =>
      transitionFine(fineId, { to, paidOn, reason: optional(formData, "reason"), actorId: principal.id }),
    );
  } catch (error) {
    return { error: await explainFine(error, "transitionFine") };
  }

  revalidatePath(`/vehicles/${vehicleId}`);
  return {};
}

export async function recoverFineAction(
  vehicleId: string,
  fineId: string,
  _previous: VehicleFormState,
  _formData: FormData,
): Promise<VehicleFormState> {
  const principal = await requirePermission("fine.manage");

  try {
    await asActor(principal, () =>
      recoverFine(fineId, { actorId: principal.id, today: businessDate(new Date()) }),
    );
  } catch (error) {
    return { error: await explainFine(error, "recoverFine") };
  }

  revalidatePath(`/vehicles/${vehicleId}`);
  // No success message: recharging moves the fine to Recovered, which replaces the
  // control that would have rendered one. The row's invoice number is the evidence.
  return {};
}

// ---------------------------------------------------------------------------
// Accidents and claims (P2-09, P2-10, SOW §13)
// ---------------------------------------------------------------------------

async function explainAccident(error: unknown, operation: string): Promise<string> {
  const t = await getTranslations("accidents.errors");
  if (error instanceof AccidentRuleError) return t(error.code);
  if (error instanceof IllegalAccidentTransitionError) {
    const ts = await getTranslations("accidents.status");
    return t("illegalTransition", { from: ts(error.from), to: ts(error.to) });
  }
  if (error instanceof IllegalClaimTransitionError) {
    const ts = await getTranslations("accidents.claimStatus");
    return t("illegalTransition", { from: ts(error.from), to: ts(error.to) });
  }
  return toUserMessage(operation, error);
}

const RESPONSIBILITIES = ["CUSTOMER", "THIRD_PARTY", "SHARED", "UNKNOWN"] as const;

export async function recordAccidentAction(
  vehicleId: string,
  _previous: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const principal = await requirePermission("accident.manage");
  const [t, te] = await Promise.all([getTranslations("accidents"), getTranslations("accidents.errors")]);

  const occurredOn = text(formData, "occurredOn");
  if (!isIsoDate(occurredOn)) return { error: te("date") };

  const responsibility = text(formData, "responsibility");

  try {
    await asActor(principal, () =>
      recordAccident(
        {
          vehicleId,
          occurredOn,
          location: text(formData, "location"),
          description: optional(formData, "description"),
          responsibility: (RESPONSIBILITIES as readonly string[]).includes(responsibility)
            ? (responsibility as (typeof RESPONSIBILITIES)[number])
            : "UNKNOWN",
          policeReportNumber: optional(formData, "policeReportNumber"),
          notes: optional(formData, "notes"),
        },
        principal.id,
      ),
    );
  } catch (error) {
    return { error: await explainAccident(error, "recordAccident") };
  }

  revalidatePath(`/vehicles/${vehicleId}`);
  return { success: t("added") };
}

export async function transitionAccidentAction(
  vehicleId: string,
  accidentId: string,
  to: AccidentStatus,
  _previous: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const principal = await requirePermission("accident.manage");

  try {
    await asActor(principal, () =>
      transitionAccident(accidentId, { to, reason: optional(formData, "reason"), actorId: principal.id }),
    );
  } catch (error) {
    return { error: await explainAccident(error, "transitionAccident") };
  }

  revalidatePath(`/vehicles/${vehicleId}`);
  return {};
}

export async function recordRepairAction(
  vehicleId: string,
  accidentId: string,
  _previous: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const principal = await requirePermission("accident.manage");
  const te = await getTranslations("accidents.errors");

  const cost = money(text(formData, "repairCost"));
  if (cost === "invalid" || cost === null) return { error: te("money") };

  const repairedOn = text(formData, "repairedOn");
  if (!isIsoDate(repairedOn)) return { error: te("date") };

  try {
    await asActor(principal, () =>
      recordRepair(accidentId, {
        repairNetFils: cost,
        vendor: text(formData, "repairVendor"),
        repairedOn,
      }),
    );
  } catch (error) {
    return { error: await explainAccident(error, "recordRepair") };
  }

  revalidatePath(`/vehicles/${vehicleId}`);
  // No success message: a recorded bill replaces the form that would have shown one.
  // The repair line and the cost to DrivenX are the evidence.
  return {};
}

export async function lodgeClaimAction(
  vehicleId: string,
  accidentId: string,
  _previous: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const principal = await requirePermission("accident.manage");
  const te = await getTranslations("accidents.errors");

  const claimed = money(text(formData, "claimedAmount"));
  if (claimed === "invalid" || claimed === null || claimed === 0n) return { error: te("money") };

  const lodgedOn = text(formData, "lodgedOn");
  if (!isIsoDate(lodgedOn)) return { error: te("date") };

  try {
    await asActor(principal, () =>
      lodgeClaim(
        {
          accidentId,
          policyId: optional(formData, "policyId"),
          claimNumber: text(formData, "claimNumber"),
          lodgedOn,
          claimedFils: claimed,
        },
        principal.id,
      ),
    );
  } catch (error) {
    return { error: await explainAccident(error, "lodgeClaim") };
  }

  revalidatePath(`/vehicles/${vehicleId}`);
  // No success message: lodging replaces the form with the claim itself.
  return {};
}

export async function transitionClaimAction(
  vehicleId: string,
  claimId: string,
  to: ClaimStatus,
  _previous: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const principal = await requirePermission("accident.manage");
  const te = await getTranslations("accidents.errors");

  const approved = money(text(formData, "approvedAmount"));
  if (approved === "invalid") return { error: te("money") };
  const received = money(text(formData, "receivedAmount"));
  if (received === "invalid") return { error: te("money") };

  const settledOn = text(formData, "settledOn");

  try {
    await asActor(principal, () =>
      transitionClaim(claimId, {
        to,
        ...(approved !== null ? { approvedFils: approved } : {}),
        ...(received !== null ? { receivedFils: received } : {}),
        ...(isIsoDate(settledOn) ? { settledOn } : {}),
        reason: optional(formData, "reason"),
        actorId: principal.id,
      }),
    );
  } catch (error) {
    return { error: await explainAccident(error, "transitionClaim") };
  }

  revalidatePath(`/vehicles/${vehicleId}`);
  return {};
}
