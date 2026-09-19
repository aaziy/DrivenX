/**
 * Leads (milestone 1F, SOW §7): the pipeline, quotes and conversion to a contract.
 *
 * The rules are in @drivenx/core (the lead status machine) and in the contract rules this
 * reuses. Two stages are earned here, never set by hand: saving a quote makes a lead Deal
 * created, and converting it makes it Contracted — in the same transaction as the customer
 * and the draft contract, which carries the lead and its salesperson (P1F-04).
 */

import {
  assertLeadTransition,
  EARNED_LEAD_STATUSES,
  normaliseUaeMobile,
  type IsoDate,
  type LeadSource,
  type LeadStatus,
} from "@drivenx/core";

import type { ContractType } from "../generated/client";
import { createContract } from "./contracts";
import { prisma } from "./index";
import { nextCustomerCode } from "./parties/codes";
import type { Tx } from "./tx";

export type LeadRuleCode =
  | "leadNotFound"
  | "invalidMobile"
  | "invalidLead"
  | "lostNeedsReason"
  | "statusEarned"
  | "leadClosed"
  | "vehicleNotFound"
  | "leasedCarNotLeaseToOwn"
  | "invalidQuote"
  | "noQuote"
  | "notReadyToConvert";

export class LeadRuleError extends Error {
  constructor(readonly code: LeadRuleCode) {
    super(`Lead refused: ${code}`);
    this.name = "LeadRuleError";
  }
}

export interface LeadFields {
  name: string;
  mobile: string;
  email?: string | null;
  source?: LeadSource;
  interestedVehicleId?: string | null;
  budgetFils?: bigint | null;
  durationMonths?: number | null;
  notes?: string | null;
  salespersonId?: string | null;
}

async function nextLeadCode(): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('lead_code_seq')`;
  return `LEAD-${String(rows[0]?.nextval ?? 0n).padStart(5, "0")}`;
}

function clean(fields: LeadFields) {
  const name = fields.name.trim();
  const mobile = normaliseUaeMobile(fields.mobile);
  if (!mobile) throw new LeadRuleError("invalidMobile");
  if (!name) throw new LeadRuleError("invalidLead");
  if (fields.budgetFils != null && fields.budgetFils < 0n) throw new LeadRuleError("invalidLead");
  if (
    fields.durationMonths != null &&
    (!Number.isInteger(fields.durationMonths) ||
      fields.durationMonths < 1 ||
      fields.durationMonths > 120)
  ) {
    throw new LeadRuleError("invalidLead");
  }
  return {
    name,
    mobile,
    email: fields.email?.trim() || null,
    source: fields.source ?? "OTHER",
    interestedVehicleId: fields.interestedVehicleId || null,
    budgetFils: fields.budgetFils ?? null,
    durationMonths: fields.durationMonths ?? null,
    notes: fields.notes?.trim() || null,
  };
}

/** A new lead, owned by the salesperson named or, by default, whoever records it. */
export async function createLead(fields: LeadFields, actorId: string | null) {
  const data = clean(fields);
  const code = await nextLeadCode();
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: { ...data, code, salespersonId: fields.salespersonId ?? actorId, createdById: actorId },
    });
    await tx.leadStatusChange.create({
      data: { leadId: lead.id, fromStatus: null, toStatus: "NEW", changedById: actorId },
    });
    return lead;
  });
}

/** Edit what is known about a lead. The salesperson changes only when one is given. */
export async function updateLead(leadId: string, fields: LeadFields) {
  const data = clean(fields);
  const { count } = await prisma.lead.updateMany({
    where: { id: leadId, deletedAt: null },
    data: {
      ...data,
      ...(fields.salespersonId !== undefined ? { salespersonId: fields.salespersonId } : {}),
    },
  });
  if (count === 0) throw new LeadRuleError("leadNotFound");
}

async function moveLead(
  tx: Tx,
  lead: { id: string; status: LeadStatus },
  to: LeadStatus,
  options: { actorId: string | null; note?: string | null; lostReason?: string | null },
) {
  assertLeadTransition(lead.status, to);
  // Compare-and-set on the status read, so two people moving it at once cannot both win.
  const { count } = await tx.lead.updateMany({
    where: { id: lead.id, status: lead.status },
    data: {
      status: to,
      // Reopening a lost lead clears why it was lost; losing it records why.
      lostReason: to === "LOST" ? (options.lostReason ?? null) : null,
    },
  });
  if (count === 0) throw new LeadRuleError("leadNotFound");
  await tx.leadStatusChange.create({
    data: {
      leadId: lead.id,
      fromStatus: lead.status,
      toStatus: to,
      note: options.note ?? null,
      changedById: options.actorId,
    },
  });
}

/** A move made by hand. The earned stages are refused: they come from a quote or a contract. */
export async function changeLeadStatus(
  leadId: string,
  to: LeadStatus,
  options: { actorId: string | null; reason?: string | null },
) {
  if (EARNED_LEAD_STATUSES.includes(to)) throw new LeadRuleError("statusEarned");
  const reason = options.reason?.trim() || null;
  if (to === "LOST" && !reason) throw new LeadRuleError("lostNeedsReason");

  await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findFirst({
      where: { id: leadId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!lead) throw new LeadRuleError("leadNotFound");
    await moveLead(tx, lead, to, { actorId: options.actorId, lostReason: reason, note: reason });
  });
}

export interface NewQuote {
  vehicleId: string;
  type: ContractType;
  durationMonths: number;
  monthlyRentalFils: bigint;
  downPaymentFils?: bigint;
  annualInsuranceFils?: bigint;
  buyoutFils?: bigint;
}

/**
 * Save a priced deal on a lead (P1F-04) and move it to Deal created.
 *
 * A priced deal means the lead was qualified, so a lead still at New or Contacted passes
 * through Qualified on the way, and the history shows both steps. The same rules as a
 * contract apply to the car: one leased from a supplier is quoted only as lease-to-own.
 */
export async function saveQuote(leadId: string, quote: NewQuote, actorId: string | null) {
  const amounts = [quote.downPaymentFils, quote.annualInsuranceFils, quote.buyoutFils];
  if (
    quote.monthlyRentalFils <= 0n ||
    amounts.some((amount) => amount !== undefined && amount < 0n) ||
    !Number.isInteger(quote.durationMonths) ||
    quote.durationMonths < 1 ||
    quote.durationMonths > 120 ||
    ((quote.buyoutFils ?? 0n) > 0n && quote.type !== "LEASE_TO_OWN")
  ) {
    throw new LeadRuleError("invalidQuote");
  }

  return prisma.$transaction(async (tx) => {
    const [lead, vehicle] = await Promise.all([
      tx.lead.findFirst({
        where: { id: leadId, deletedAt: null },
        select: { id: true, status: true },
      }),
      tx.vehicle.findFirst({
        where: { id: quote.vehicleId, deletedAt: null },
        select: { ownershipType: true },
      }),
    ]);
    if (!lead) throw new LeadRuleError("leadNotFound");
    if (!vehicle) throw new LeadRuleError("vehicleNotFound");
    if (lead.status === "CONTRACTED" || lead.status === "LOST")
      throw new LeadRuleError("leadClosed");
    if (vehicle.ownershipType === "B2B_SUPPLIER" && quote.type !== "LEASE_TO_OWN") {
      throw new LeadRuleError("leasedCarNotLeaseToOwn");
    }

    const saved = await tx.leadQuote.create({
      data: {
        leadId,
        vehicleId: quote.vehicleId,
        type: quote.type,
        durationMonths: quote.durationMonths,
        monthlyRentalFils: quote.monthlyRentalFils,
        downPaymentFils: quote.downPaymentFils ?? 0n,
        annualInsuranceFils: quote.annualInsuranceFils ?? 0n,
        buyoutFils: quote.buyoutFils ?? 0n,
        createdById: actorId,
      },
    });

    let status = lead.status;
    if (status === "NEW" || status === "CONTACTED") {
      await moveLead(tx, { id: leadId, status }, "QUALIFIED", { actorId });
      status = "QUALIFIED";
    }
    if (status === "QUALIFIED")
      await moveLead(tx, { id: leadId, status }, "DEAL_CREATED", { actorId });
    return saved;
  });
}

/**
 * Convert a lead with a deal into a draft contract (P1F-04).
 *
 * The customer is the one already on file with the lead's mobile, or a new record made
 * from the lead. The contract takes the latest quote's terms, the lead, and the lead's
 * salesperson — so the sale is credited to whoever worked it, not whoever clicked. All of
 * it, and the lead becoming Contracted, is one transaction.
 */
export async function convertLead(
  leadId: string,
  options: { startDate: IsoDate; actorId: string | null },
) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, deletedAt: null },
    include: { quotes: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!lead) throw new LeadRuleError("leadNotFound");
  if (lead.status !== "DEAL_CREATED") throw new LeadRuleError("notReadyToConvert");
  const quote = lead.quotes[0];
  if (!quote) throw new LeadRuleError("noQuote");

  // Allocated before the transaction: a sequence does not roll back anyway.
  const customerCode = await nextCustomerCode();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.customer.findFirst({
      where: { mobile: lead.mobile, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const customer =
      existing ??
      (await tx.customer.create({
        data: {
          code: customerCode,
          fullName: lead.name,
          mobile: lead.mobile,
          email: lead.email,
          notes: `From ${lead.code}`,
          createdById: options.actorId,
        },
        select: { id: true },
      }));

    // The contract's own refusals — a blacklisted customer, a leased car on the wrong
    // terms — pass through as ContractRuleError, and roll all of this back.
    const contract = await createContract(
      {
        customerId: customer.id,
        vehicleId: quote.vehicleId,
        type: quote.type,
        startDate: options.startDate,
        durationMonths: quote.durationMonths,
        monthlyRentalFils: quote.monthlyRentalFils,
        downPaymentFils: quote.downPaymentFils,
        annualInsuranceFils: quote.annualInsuranceFils,
        buyoutFils: quote.buyoutFils,
        leadId: lead.id,
        salespersonId: lead.salespersonId ?? options.actorId,
      },
      options.actorId,
      tx,
    );

    await tx.lead.update({ where: { id: lead.id }, data: { customerId: customer.id } });
    await moveLead(tx, { id: lead.id, status: "DEAL_CREATED" }, "CONTRACTED", {
      actorId: options.actorId,
    });
    return { contract, customerId: customer.id, customerCreated: !existing };
  });
}

/** Leads a person may see: all of them, or only their own (P1F-05). */
export function leadScope(principal: { id: string; seeAll: boolean }) {
  return principal.seeAll ? { deletedAt: null } : { deletedAt: null, salespersonId: principal.id };
}
