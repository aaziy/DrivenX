/**
 * Posting to the ledger (P1D-14, §3.2 of the plan).
 *
 * The only way anything reaches `ledger_entries`. Domain events call it — an instalment
 * falling due, a supplier invoice, a maintenance bill — and nothing else writes the table,
 * which is what lets every report be a GROUP BY over it.
 *
 * Idempotent: an entry is unique on what produced it and its category, so posting the same
 * event twice is a no-op rather than twice the revenue. A nightly job that is retried, or
 * two that overlap, cannot double-count.
 */

import { periodMonthOf, type IsoDate } from "@drivenx/core";

import type { LedgerDirection } from "../generated/client";
import type { Tx } from "./tx";
import { toDbDate } from "./dates";

export interface LedgerPosting {
  occurredOn: IsoDate;
  direction: LedgerDirection;
  category: string;
  amountFils: bigint;
  vehicleId?: string | null;
  contractId?: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  sourceType: string;
  sourceId: string;
  /** Set only on a correcting entry, which carries the opposite amount (INV-7). */
  reversesId?: string | null;
  memo?: string | null;
}

/** Returns true if the entry was written, false if it had already been posted. */
export async function postToLedger(
  tx: Tx,
  posting: LedgerPosting,
): Promise<boolean> {
  const { count } = await tx.ledgerEntry.createMany({
    data: [
      {
        occurredOn: toDbDate(posting.occurredOn),
        periodMonth: periodMonthOf(posting.occurredOn),
        direction: posting.direction,
        category: posting.category,
        amountFils: posting.amountFils,
        vehicleId: posting.vehicleId ?? null,
        contractId: posting.contractId ?? null,
        customerId: posting.customerId ?? null,
        supplierId: posting.supplierId ?? null,
        sourceType: posting.sourceType,
        sourceId: posting.sourceId,
        reversesId: posting.reversesId ?? null,
        memo: posting.memo ?? null,
      },
    ],
    skipDuplicates: true,
  });
  return count === 1;
}
