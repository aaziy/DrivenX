/**
 * The conversion funnel (P1F-06).
 *
 * For the leads recorded in a range: how many reached each stage, how many were lost and
 * why, and the same by salesperson and by source. "Reached" is read from each lead's
 * history, not its current status — a lead that was priced and then lost did reach Deal
 * created, and the funnel should say so.
 */

import { LEAD_FUNNEL, type IsoDate, type LeadSource, type LeadStatus } from "@drivenx/core";

import { prisma } from "./index";
import { leadScope } from "./leads";

export interface FunnelCounts {
  /** Leads recorded in the range. */
  created: number;
  /** How many reached each stage of LEAD_FUNNEL, in order; the first is `created`. */
  reached: number[];
  lost: number;
}

export interface FunnelReport extends FunnelCounts {
  lostReasons: Array<{ reason: string; count: number }>;
  bySalesperson: Array<FunnelCounts & { salespersonId: string | null; name: string | null }>;
  bySource: Array<FunnelCounts & { source: LeadSource }>;
}

const STAGE_INDEX = new Map<LeadStatus, number>(LEAD_FUNNEL.map((stage, index) => [stage, index]));

function empty(): FunnelCounts {
  return { created: 0, reached: LEAD_FUNNEL.map(() => 0), lost: 0 };
}

function count(into: FunnelCounts, furthest: number, lost: boolean) {
  into.created += 1;
  for (let stage = 0; stage <= furthest; stage += 1) into.reached[stage] = (into.reached[stage] ?? 0) + 1;
  if (lost) into.lost += 1;
}

export async function leadFunnel(options: {
  from: IsoDate;
  to: IsoDate;
  scope: { id: string; seeAll: boolean };
  salespersonId?: string | null;
}): Promise<FunnelReport> {
  // The range is of calendar days in Dubai; a lead recorded at 23:30 on the last day counts.
  const leads = await prisma.lead.findMany({
    where: {
      ...leadScope(options.scope),
      ...(options.scope.seeAll && options.salespersonId ? { salespersonId: options.salespersonId } : {}),
      createdAt: {
        gte: new Date(`${options.from}T00:00:00+04:00`),
        lt: new Date(new Date(`${options.to}T00:00:00+04:00`).getTime() + 86_400_000),
      },
    },
    select: {
      status: true,
      source: true,
      lostReason: true,
      salespersonId: true,
      salesperson: { select: { fullName: true } },
      statusChanges: { select: { toStatus: true } },
    },
  });

  const total = empty();
  const reasons = new Map<string, number>();
  const people = new Map<string | null, FunnelCounts & { salespersonId: string | null; name: string | null }>();
  const sources = new Map<LeadSource, FunnelCounts & { source: LeadSource }>();

  for (const lead of leads) {
    const furthest = Math.max(
      0,
      ...lead.statusChanges.map((change) => STAGE_INDEX.get(change.toStatus) ?? 0),
      STAGE_INDEX.get(lead.status) ?? 0,
    );
    const lost = lead.status === "LOST";
    count(total, furthest, lost);

    const person = people.get(lead.salespersonId) ?? {
      ...empty(),
      salespersonId: lead.salespersonId,
      name: lead.salesperson?.fullName ?? null,
    };
    count(person, furthest, lost);
    people.set(lead.salespersonId, person);

    const source = sources.get(lead.source) ?? { ...empty(), source: lead.source };
    count(source, furthest, lost);
    sources.set(lead.source, source);

    if (lost && lead.lostReason) {
      const reason = lead.lostReason.trim();
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
  }

  const byCreated = <T extends FunnelCounts>(a: T, b: T) => b.created - a.created;
  return {
    ...total,
    lostReasons: [...reasons.entries()]
      .map(([reason, n]) => ({ reason, count: n }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    bySalesperson: [...people.values()].sort(byCreated),
    bySource: [...sources.values()].sort(byCreated),
  };
}
