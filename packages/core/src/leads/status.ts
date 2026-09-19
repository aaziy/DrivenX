/**
 * The lead pipeline (P1F-02, SOW §7).
 *
 * New → Contacted → Qualified → Deal created → Contracted, with Lost as a way out of any
 * open stage and back in again: a lead that went quiet sometimes calls back.
 *
 * Two stages are earned, not chosen. Deal created is set by saving a priced quote on the
 * lead, and Contracted by converting it into a contract, so the funnel counts deals and
 * contracts that exist rather than ones someone clicked into being. A salesperson can
 * step a lead back from Deal created to Qualified when the deal falls through.
 */

export const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "DEAL_CREATED", "CONTRACTED", "LOST"] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** The stages in funnel order, Lost aside. */
export const LEAD_FUNNEL: readonly LeadStatus[] = ["NEW", "CONTACTED", "QUALIFIED", "DEAL_CREATED", "CONTRACTED"];

const TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  NEW: ["CONTACTED", "QUALIFIED", "LOST"],
  CONTACTED: ["QUALIFIED", "LOST"],
  QUALIFIED: ["CONTACTED", "DEAL_CREATED", "LOST"],
  DEAL_CREATED: ["QUALIFIED", "CONTRACTED", "LOST"],
  CONTRACTED: [],
  // Reopened where the conversation stands now, not where it stood.
  LOST: ["NEW", "CONTACTED"],
};

/** Set only by the action that justifies them, never picked from a list. */
export const EARNED_LEAD_STATUSES: readonly LeadStatus[] = ["DEAL_CREATED", "CONTRACTED"];

export function isLeadStatus(value: string): value is LeadStatus {
  return (LEAD_STATUSES as readonly string[]).includes(value);
}

export function allowedLeadTransitions(from: LeadStatus): readonly LeadStatus[] {
  return TRANSITIONS[from];
}

/** The moves a person may make by hand: the allowed ones, less the earned stages. */
export function manualLeadTransitions(from: LeadStatus): readonly LeadStatus[] {
  return TRANSITIONS[from].filter((to) => !EARNED_LEAD_STATUSES.includes(to));
}

export function canTransitionLead(from: LeadStatus, to: LeadStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalLeadTransitionError extends Error {
  constructor(
    readonly from: LeadStatus,
    readonly to: LeadStatus,
  ) {
    super(`A lead cannot move from ${from} to ${to}`);
    this.name = "IllegalLeadTransitionError";
  }
}

export function assertLeadTransition(from: LeadStatus, to: LeadStatus): void {
  if (!canTransitionLead(from, to)) throw new IllegalLeadTransitionError(from, to);
}

/** A lead is open while it can still become a contract. */
export function isOpenLead(status: LeadStatus): boolean {
  return status !== "CONTRACTED" && status !== "LOST";
}

export const LEAD_SOURCES = ["WALK_IN", "PHONE", "WHATSAPP", "WEBSITE", "SOCIAL", "REFERRAL", "OTHER"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
