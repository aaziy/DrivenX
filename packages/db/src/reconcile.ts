/**
 * The financial invariants, checked against what is actually stored (IMPLEMENTATION_PLAN
 * §2.3).
 *
 * Returns every violation it finds rather than stopping at the first, so it can serve as
 * a health check as well as a test: run it and read the list. An empty list means the
 * books are internally consistent — the schedules add up, every payment is fully
 * accounted for, the ledger holds exactly the revenue that has been issued and the supplier
 * cost that has been raised, and no car is out without a contract.
 */

import { expandCharge, vatOn, type ScheduledCharge } from "@drivenx/core";

import { fromDbDate } from "./dates";
import { prisma } from "./index";

export interface Violation {
  invariant: string;
  subject: string;
  detail: string;
}

export async function reconcile(): Promise<Violation[]> {
  const violations: Violation[] = [];

  // INV-1: each charge's instalments are exactly what the charge expands to — count and fils.
  const contracts = await prisma.contract.findMany({
    where: { charges: { some: {} } },
    select: {
      number: true,
      durationMonths: true,
      charges: { include: { installments: { select: { netFils: true } } } },
    },
  });
  for (const contract of contracts) {
    for (const charge of contract.charges) {
      const expected = expandCharge(
        {
          key: charge.key,
          chargeType: charge.chargeType,
          label: charge.label,
          recurrence: charge.recurrence,
          amount: charge.amountFils,
          startsOn: fromDbDate(charge.startsOn),
          occurrences: charge.occurrences,
          vatBasisPoints: charge.vatBasisPoints,
        } satisfies ScheduledCharge,
        contract.durationMonths,
      );
      const expectedNet = expected.reduce((sum, item) => sum + item.netFils, 0n);
      const actualNet = charge.installments.reduce((sum, item) => sum + item.netFils, 0n);
      if (expected.length !== charge.installments.length || expectedNet !== actualNet) {
        violations.push({
          invariant: "INV-1",
          subject: `${contract.number} ${charge.key}`,
          detail: `expected ${expected.length} instalments / ${expectedNet} fils, found ${charge.installments.length} / ${actualNet}`,
        });
      }
    }
  }

  // INV-2: a payment's allocations plus its credit are exactly the payment.
  const payments = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT p.id FROM payments p
    LEFT JOIN payment_allocations a ON a.payment_id = p.id
    GROUP BY p.id, p.amount_fils, p.credit_fils
    HAVING COALESCE(SUM(a.amount_fils), 0) + p.credit_fils <> p.amount_fils`;
  for (const row of payments) {
    violations.push({ invariant: "INV-2", subject: row.id, detail: "allocations + credit ≠ payment" });
  }

  // INV-3: what an instalment says is paid is exactly what was allocated to it.
  const installments = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT i.id FROM installments i
    LEFT JOIN payment_allocations a ON a.installment_id = i.id
    GROUP BY i.id, i.paid_fils
    HAVING i.paid_fils <> COALESCE(SUM(a.amount_fils), 0)`;
  for (const row of installments) {
    violations.push({ invariant: "INV-3", subject: row.id, detail: "paid ≠ sum of allocations" });
  }

  // INV-4: a contract's ledger revenue is the net of what has been issued and not waived.
  const revenue = await prisma.$queryRaw<Array<{ number: string; ledger: bigint; issued: bigint }>>`
    SELECT c.number,
      (SELECT COALESCE(SUM(l.amount_fils), 0) FROM ledger_entries l
        WHERE l.contract_id = c.id AND l.direction = 'REVENUE')::bigint AS ledger,
      (SELECT COALESCE(SUM(i.net_fils), 0) FROM installments i
        WHERE i.contract_id = c.id AND i.invoice_number IS NOT NULL AND i.waived_at IS NULL)::bigint AS issued
    FROM contracts c`;
  for (const row of revenue) {
    if (row.ledger !== row.issued) {
      violations.push({
        invariant: "INV-4",
        subject: row.number,
        detail: `ledger revenue ${row.ledger} ≠ issued net ${row.issued}`,
      });
    }
  }

  // INV-9, one way: a live contract's car is not sitting available, sold or inactive.
  const strays = await prisma.$queryRaw<Array<{ number: string; status: string }>>`
    SELECT c.number, v.status::text AS status FROM contracts c
    JOIN vehicles v ON v.id = c.vehicle_id
    WHERE c.status IN ('ACTIVE', 'OVERDUE') AND c.deleted_at IS NULL
      AND v.status IN ('AVAILABLE', 'SOLD', 'INACTIVE', 'RESERVED')`;
  for (const row of strays) {
    violations.push({ invariant: "INV-9", subject: row.number, detail: `live contract, car is ${row.status}` });
  }

  // INV-9, the other way: a car that is out is out on exactly one live contract.
  const unexplained = await prisma.$queryRaw<Array<{ code: string; live: bigint }>>`
    SELECT v.code, COUNT(c.id) AS live FROM vehicles v
    LEFT JOIN contracts c ON c.vehicle_id = v.id
      AND c.status IN ('ACTIVE', 'OVERDUE') AND c.deleted_at IS NULL
    WHERE v.status IN ('RENTED', 'LEASE_TO_OWN') AND v.deleted_at IS NULL
    GROUP BY v.code
    HAVING COUNT(c.id) <> 1`;
  for (const row of unexplained) {
    violations.push({ invariant: "INV-9", subject: row.code, detail: `car is out on ${row.live} live contracts` });
  }

  // INV-10: VAT on each instalment is its own rate applied to its own net.
  const priced = await prisma.installment.findMany({
    select: { id: true, netFils: true, vatFils: true, grossFils: true, vatBasisPoints: true },
  });
  for (const item of priced) {
    if (item.vatFils !== vatOn(item.netFils, item.vatBasisPoints) || item.grossFils !== item.netFils + item.vatFils) {
      violations.push({ invariant: "INV-10", subject: item.id, detail: "VAT or gross does not follow from net" });
    }
  }

  // INV-11: what a supplier invoice says is paid is exactly what was paid against it.
  const payables = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT s.id FROM supplier_invoices s
    LEFT JOIN supplier_payments p ON p.supplier_invoice_id = s.id
    GROUP BY s.id, s.paid_fils
    HAVING s.paid_fils <> COALESCE(SUM(p.amount_fils), 0)`;
  for (const row of payables) {
    violations.push({ invariant: "INV-11", subject: row.id, detail: "supplier paid ≠ sum of payments" });
  }

  // INV-12: a contract's supplier cost in the ledger is exactly the invoices raised on it.
  const supplierCost = await prisma.$queryRaw<Array<{ number: string; ledger: bigint; raised: bigint }>>`
    SELECT c.number,
      (SELECT COALESCE(SUM(l.amount_fils), 0) FROM ledger_entries l
        WHERE l.contract_id = c.id AND l.category = 'cost.supplier')::bigint AS ledger,
      (SELECT COALESCE(SUM(s.net_fils), 0) FROM supplier_invoices s
        WHERE s.contract_id = c.id AND s.raised_on IS NOT NULL)::bigint AS raised
    FROM contracts c`;
  for (const row of supplierCost) {
    if (row.ledger !== row.raised) {
      violations.push({
        invariant: "INV-12",
        subject: row.number,
        detail: `ledger supplier cost ${row.ledger} ≠ raised ${row.raised}`,
      });
    }
  }

  return violations;
}
