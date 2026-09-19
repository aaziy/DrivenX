"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { can } from "@drivenx/auth";
import {
  IllegalLeadTransitionError,
  isIsoDate,
  isLeadStatus,
  LEAD_SOURCES,
  Money,
  type Fils,
  type LeadSource,
} from "@drivenx/core";
import {
  changeLeadStatus,
  ContractRuleError,
  convertLead,
  createLead,
  LeadRuleError,
  saveQuote,
  updateLead,
  type LeadFields,
} from "@drivenx/db";

import { asActor, requirePermission } from "@/lib/auth";
import { findScopedLead } from "@/lib/leads";
import { toUserMessage } from "@/lib/log";

export interface LeadFormState {
  error?: string;
  success?: string;
}

const CONTRACT_TYPES = ["LONG_TERM_RENTAL", "LEASE_TO_OWN", "B2B_RENTAL", "OTHER"] as const;

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

/** Every refusal the lead service can give, as a sentence in the reader's language. */
async function explain(error: unknown, operation: string): Promise<string> {
  const t = await getTranslations("leads.errors");
  if (error instanceof LeadRuleError) return t(error.code);
  if (error instanceof IllegalLeadTransitionError) {
    const ts = await getTranslations("leads.status");
    return t("illegalTransition", { from: ts(error.from), to: ts(error.to) });
  }
  if (error instanceof ContractRuleError) {
    const tc = await getTranslations("contracts.errors");
    return tc(error.code);
  }
  return toUserMessage(operation, error);
}

async function readLead(formData: FormData, canAssign: boolean): Promise<LeadFields | string> {
  const t = await getTranslations("leads.errors");
  const budget = money(text(formData, "budget"));
  if (budget === "invalid") return t("money");
  const durationText = text(formData, "durationMonths");
  const duration = durationText === "" ? null : Number(durationText);
  const source = text(formData, "source");

  return {
    name: text(formData, "name"),
    mobile: text(formData, "mobile"),
    email: text(formData, "email") || null,
    source: (LEAD_SOURCES as readonly string[]).includes(source) ? (source as LeadSource) : "OTHER",
    interestedVehicleId: text(formData, "interestedVehicleId") || null,
    budgetFils: budget,
    durationMonths: duration,
    notes: text(formData, "notes") || null,
    // Only someone who can see everyone's leads may hand one to someone else.
    ...(canAssign ? { salespersonId: text(formData, "salespersonId") || null } : {}),
  };
}

export async function createLeadAction(_previous: LeadFormState, formData: FormData): Promise<LeadFormState> {
  const principal = await requirePermission("lead.create");
  const fields = await readLead(formData, can(principal, "lead.view_all"));
  if (typeof fields === "string") return { error: fields };

  let leadId: string;
  try {
    const lead = await asActor(principal, () => createLead(fields, principal.id));
    leadId = lead.id;
  } catch (error) {
    return { error: await explain(error, "createLead") };
  }
  revalidatePath("/leads");
  redirect(`/leads/${leadId}`);
}

export async function updateLeadAction(
  leadId: string,
  _previous: LeadFormState,
  formData: FormData,
): Promise<LeadFormState> {
  const principal = await requirePermission("lead.update");
  const [t, te] = await Promise.all([getTranslations("leads"), getTranslations("leads.errors")]);
  if (!(await findScopedLead(principal, leadId))) return { error: te("leadNotFound") };

  const fields = await readLead(formData, can(principal, "lead.view_all"));
  if (typeof fields === "string") return { error: fields };

  try {
    await asActor(principal, () => updateLead(leadId, fields));
  } catch (error) {
    return { error: await explain(error, "updateLead") };
  }
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  return { success: t("saved") };
}

export async function changeLeadStatusAction(
  leadId: string,
  _previous: LeadFormState,
  formData: FormData,
): Promise<LeadFormState> {
  const principal = await requirePermission("lead.update");
  const te = await getTranslations("leads.errors");
  if (!(await findScopedLead(principal, leadId))) return { error: te("leadNotFound") };

  const to = text(formData, "status");
  if (!isLeadStatus(to)) return { error: te("chooseStatus") };

  try {
    await asActor(principal, () =>
      changeLeadStatus(leadId, to, { actorId: principal.id, reason: text(formData, "reason") || null }),
    );
  } catch (error) {
    return { error: await explain(error, "changeLeadStatus") };
  }
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  return {};
}

export async function saveQuoteAction(
  leadId: string,
  _previous: LeadFormState,
  formData: FormData,
): Promise<LeadFormState> {
  const principal = await requirePermission("deal.calculate");
  const te = await getTranslations("leads.errors");
  if (!can(principal, "lead.update")) return { error: te("leadNotFound") };
  if (!(await findScopedLead(principal, leadId))) return { error: te("leadNotFound") };

  const vehicleId = text(formData, "vehicleId");
  if (!vehicleId) return { error: te("chooseVehicle") };
  const type = text(formData, "type");
  const monthly = money(text(formData, "monthlyRental"));
  const down = money(text(formData, "downPayment"));
  const insurance = money(text(formData, "annualInsurance"));
  const buyout = money(text(formData, "buyout"));
  if ([monthly, down, insurance, buyout].includes("invalid") || monthly === null) return { error: te("invalidQuote") };

  try {
    await asActor(principal, () =>
      saveQuote(
        leadId,
        {
          vehicleId,
          type: (CONTRACT_TYPES as readonly string[]).includes(type)
            ? (type as (typeof CONTRACT_TYPES)[number])
            : "LONG_TERM_RENTAL",
          durationMonths: Number(text(formData, "durationMonths")),
          monthlyRentalFils: monthly as Fils,
          downPaymentFils: (down as Fils | null) ?? 0n,
          annualInsuranceFils: (insurance as Fils | null) ?? 0n,
          buyoutFils: type === "LEASE_TO_OWN" ? ((buyout as Fils | null) ?? 0n) : 0n,
        },
        principal.id,
      ),
    );
  } catch (error) {
    return { error: await explain(error, "saveQuote") };
  }
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  return {};
}

export async function convertLeadAction(
  leadId: string,
  _previous: LeadFormState,
  formData: FormData,
): Promise<LeadFormState> {
  const principal = await requirePermission("lead.convert");
  const te = await getTranslations("leads.errors");
  // Writing the contract is the contract permission's business too.
  if (!can(principal, "contract.create")) return { error: te("notReadyToConvert") };
  if (!(await findScopedLead(principal, leadId))) return { error: te("leadNotFound") };

  const startDate = text(formData, "startDate");
  if (!isIsoDate(startDate)) return { error: te("startDate") };

  let contractId: string;
  try {
    const result = await asActor(principal, () => convertLead(leadId, { startDate, actorId: principal.id }));
    contractId = result.contract.id;
  } catch (error) {
    return { error: await explain(error, "convertLead") };
  }
  revalidatePath("/leads");
  revalidatePath("/contracts");
  redirect(`/contracts/${contractId}`);
}
