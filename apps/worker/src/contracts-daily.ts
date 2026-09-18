/**
 * The nightly contract run (P1D-09).
 *
 * Two steps, in this order. First everything that has fallen due is issued: each customer
 * instalment gets its tax invoice number and its revenue booked, and each supplier invoice
 * on a leased-in car has its cost booked. Then anything issued, past due and unpaid is
 * marked Overdue, along with its contract. The order matters: the overdue pass looks at
 * issued instalments, so what fell due yesterday must be issued before it runs.
 *
 * Both steps are idempotent, so a missed night is caught up by the next and a run repeated
 * by hand changes nothing.
 */

import { businessDate } from "@drivenx/core";
import {
  issueDueInstallments,
  raiseDueSupplierInvoices,
  refreshOverdue,
  refreshSupplierOverdue,
} from "@drivenx/db";
import { logger } from "@drivenx/logger";

export async function runContractsDaily(today: string = businessDate(new Date())) {
  const issued = await issueDueInstallments(today);
  const supplierRaised = await raiseDueSupplierInvoices(today);
  const overdue = await refreshOverdue(today);
  const supplierOverdue = await refreshSupplierOverdue(today);
  return { today, issued, supplierRaised, overdue, supplierOverdue };
}

export async function runContractsDailyLogged(): Promise<void> {
  const startedAt = Date.now();
  const result = await runContractsDaily();
  logger.info("contracts daily run complete", { ...result, durationMs: Date.now() - startedAt });
}
