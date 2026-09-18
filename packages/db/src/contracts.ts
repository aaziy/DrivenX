/**
 * Contracts: writing, activating and issuing (milestone 1D).
 *
 * The rules are pure and live in @drivenx/core — the schedule, the contract and vehicle
 * state machines, instalment status. This is the I/O, organised so that each operation
 * that touches a contract's money is one transaction holding a lock on the contract row.
 *
 * Revenue is recognised when an instalment falls due, not when the contract is activated.
 * Posting a 36-month contract's revenue on the day it starts would put three years of
 * income in one month's report; posting each instalment on its due date puts it in the
 * month it belongs to, and a contract cancelled early simply never posts the months it
 * did not reach. A payment is not revenue — that is recognised on the instalment — so
 * posting payments as well would count every dirham twice.
 */

import {
  allocatePayment,
  assertContractTransition,
  assertTransition,
  chargesFor,
  contractEndDate,
  expandCharge,
  installmentStatus,
  type ChargeType,
  type ContractTerms,
  type IsoDate,
} from "@drivenx/core";

import type { ContractStatus, ContractType, PaymentMethod } from "../generated/client";
import type { Tx } from "./tx";
import { fromDbDate, toDbDate } from "./dates";
import { prisma } from "./index";
import { postToLedger } from "./ledger";
import { raiseDueSupplierInvoicesForContract, writeSupplierSchedule } from "./supplier-invoices";

export type ContractRuleCode =
  | "customerNotFound"
  | "customerBlacklisted"
  | "vehicleNotFound"
  | "leasedCarNotLeaseToOwn"
  | "buyoutOnlyOnLeaseToOwn"
  | "invalidTerms"
  | "contractNotFound"
  | "vehicleOnLiveContract"
  | "contractNotLive"
  | "invalidPayment"
  | "paymentInFuture"
  | "installmentNotFound"
  | "waiveNeedsReason"
  | "alreadyWaived"
  | "waivePaidInstallment"
  | "supplierCostMissing";

export class ContractRuleError extends Error {
  constructor(readonly code: ContractRuleCode) {
    super(`Contract refused: ${code}`);
    this.name = "ContractRuleError";
  }
}

export interface NewContract {
  customerId: string;
  vehicleId: string;
  type: ContractType;
  startDate: IsoDate;
  durationMonths: number;
  monthlyRentalFils: bigint;
  downPaymentFils?: bigint;
  buyoutFils?: bigint;
  annualInsuranceFils?: bigint;
  vatBasisPoints?: number;
  mileageAllowanceKm?: number | null;
  excessMileageRateFils?: bigint | null;
  terms?: string | null;
}

const MAX_MONTHS = 120;

/** Revenue categories by charge (§3.2). A down payment is consideration for the rental. */
const REVENUE_CATEGORY: Record<ChargeType, string> = {
  MONTHLY_RENTAL: "revenue.rental",
  DOWN_PAYMENT: "revenue.rental",
  ANNUAL_INSURANCE: "revenue.insurance",
  BUYOUT: "revenue.other",
  ADMIN_FEE: "revenue.other",
  OTHER: "revenue.other",
};

/** Serialises everything touching one contract's money: a second caller waits here. */
async function lockContract(tx: Tx, contractId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId} FOR UPDATE`;
}

async function nextContractNumber(): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('contract_code_seq')`;
  return `CON-${String(rows[0]?.nextval ?? 0n).padStart(5, "0")}`;
}

/**
 * The next tax invoice number, gapless.
 *
 * Incremented inside the caller's transaction, so the row stays locked until it commits
 * and a second issuer waits; and if the transaction rolls back, the increment rolls back
 * with it. A sequence gives neither — it skips a number on every rollback.
 */
export async function nextInvoiceNumber(tx: Tx): Promise<string> {
  await tx.$executeRaw`INSERT INTO invoice_counters (id, next) VALUES ('tax-invoice', 1) ON CONFLICT (id) DO NOTHING`;
  const rows = await tx.$queryRaw<Array<{ issued: bigint }>>`
    UPDATE invoice_counters SET next = next + 1 WHERE id = 'tax-invoice' RETURNING next - 1 AS issued`;
  return `INV-${String(rows[0]?.issued ?? 0n).padStart(6, "0")}`;
}

function validTerms(input: NewContract): boolean {
  const money = [input.monthlyRentalFils, input.downPaymentFils, input.buyoutFils, input.annualInsuranceFils];
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(input.startDate) &&
    Number.isInteger(input.durationMonths) &&
    input.durationMonths >= 1 &&
    input.durationMonths <= MAX_MONTHS &&
    money.every((amount) => amount === undefined || amount >= 0n)
  );
}

/** Write a draft. Nothing financial exists until it is activated. */
export async function createContract(input: NewContract, actorId: string | null) {
  if (!validTerms(input)) throw new ContractRuleError("invalidTerms");

  const [customer, vehicle] = await Promise.all([
    prisma.customer.findFirst({ where: { id: input.customerId, deletedAt: null }, select: { status: true } }),
    prisma.vehicle.findFirst({
      where: { id: input.vehicleId, deletedAt: null },
      select: { ownershipType: true, supplierId: true },
    }),
  ]);
  if (!customer) throw new ContractRuleError("customerNotFound");
  if (customer.status === "BLACKLISTED") throw new ContractRuleError("customerBlacklisted");
  if (!vehicle) throw new ContractRuleError("vehicleNotFound");

  // A car leased in from a supplier goes to a customer only on lease-to-own (2026-09-18).
  if (vehicle.ownershipType === "B2B_SUPPLIER" && input.type !== "LEASE_TO_OWN") {
    throw new ContractRuleError("leasedCarNotLeaseToOwn");
  }
  if ((input.buyoutFils ?? 0n) > 0n && input.type !== "LEASE_TO_OWN") {
    throw new ContractRuleError("buyoutOnlyOnLeaseToOwn");
  }

  const number = await nextContractNumber();

  return prisma.$transaction(async (tx) => {
    const contract = await tx.contract.create({
      data: {
        number,
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        supplierId: vehicle.supplierId,
        type: input.type,
        startDate: toDbDate(input.startDate),
        endDate: toDbDate(contractEndDate(input.startDate, input.durationMonths)),
        durationMonths: input.durationMonths,
        monthlyRentalFils: input.monthlyRentalFils,
        downPaymentFils: input.downPaymentFils ?? 0n,
        buyoutFils: input.buyoutFils ?? 0n,
        annualInsuranceFils: input.annualInsuranceFils ?? 0n,
        vatBasisPoints: input.vatBasisPoints ?? 500,
        mileageAllowanceKm: input.mileageAllowanceKm ?? null,
        excessMileageRateFils: input.excessMileageRateFils ?? null,
        terms: input.terms ?? null,
        createdById: actorId,
      },
    });
    await tx.contractStatusChange.create({
      data: { contractId: contract.id, fromStatus: null, toStatus: "DRAFT", changedById: actorId },
    });
    return contract;
  });
}

type IssuableInstallment = {
  id: string;
  dueDate: Date;
  grossFils: bigint;
  paidFils: bigint;
  netFils: bigint;
  waivedAt: Date | null;
  charge: { chargeType: ChargeType };
};

type ContractDimensions = {
  id: string;
  customerId: string;
  vehicleId: string;
  supplierId: string | null;
  number: string;
};

/**
 * Issue one instalment: give it its tax invoice number, set its status, and recognise its
 * revenue — net of VAT, which is the FTA's and never revenue (INV-4).
 */
async function issueInstallment(
  tx: Tx,
  item: IssuableInstallment,
  contract: ContractDimensions,
  today: IsoDate,
): Promise<void> {
  const dueDate = fromDbDate(item.dueDate);
  const status = installmentStatus(
    { dueDate, grossFils: item.grossFils, paidFils: item.paidFils, waived: item.waivedAt !== null },
    today,
  );

  // Guarded on the number still being empty, so a concurrent issuer cannot number it twice.
  const claimed = await tx.installment.updateMany({
    where: { id: item.id, invoiceNumber: null },
    data: { invoiceNumber: await nextInvoiceNumber(tx), issuedOn: toDbDate(today), status },
  });
  if (claimed.count === 0) throw new Error(`Instalment ${item.id} was issued concurrently`);

  await postToLedger(tx, {
    occurredOn: dueDate,
    direction: "REVENUE",
    category: REVENUE_CATEGORY[item.charge.chargeType],
    amountFils: item.netFils,
    vehicleId: contract.vehicleId,
    contractId: contract.id,
    customerId: contract.customerId,
    supplierId: contract.supplierId,
    sourceType: "Installment",
    sourceId: item.id,
    memo: contract.number,
  });
}

async function issueDueForContract(
  tx: Tx,
  contract: ContractDimensions,
  today: IsoDate,
): Promise<number> {
  const due = await tx.installment.findMany({
    where: { contractId: contract.id, invoiceNumber: null, waivedAt: null, dueDate: { lte: toDbDate(today) } },
    orderBy: [{ dueDate: "asc" }, { sequence: "asc" }],
    select: {
      id: true,
      dueDate: true,
      grossFils: true,
      paidFils: true,
      netFils: true,
      waivedAt: true,
      charge: { select: { chargeType: true } },
    },
  });
  for (const item of due) await issueInstallment(tx, item, contract, today);
  return due.length;
}

/**
 * Activate a draft or pending contract.
 *
 * One transaction: the charges and their full schedule, the vehicle moving to Rented or
 * Lease-to-own, the contract moving to Active, and the instalments already due issued with
 * their revenue. Refused whole if any part is refused — a car that is sold, in the
 * workshop, or already on another live contract; a customer since blacklisted.
 */
export async function activateContract(
  contractId: string,
  options: { actorId: string | null; today: IsoDate },
): Promise<{ installments: number; issued: number; supplierInvoices: number; supplierRaised: number }> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await lockContract(tx, contractId);

        const contract = await tx.contract.findFirst({
          where: { id: contractId, deletedAt: null },
          include: {
            customer: { select: { status: true } },
            vehicle: {
              select: { id: true, status: true, ownershipType: true, supplierId: true, supplierMonthlyCostFils: true },
            },
          },
        });
        if (!contract) throw new ContractRuleError("contractNotFound");
        if (contract.customer.status === "BLACKLISTED") throw new ContractRuleError("customerBlacklisted");

        assertContractTransition(contract.status, "ACTIVE");

        const vehicleTarget = contract.type === "LEASE_TO_OWN" ? "LEASE_TO_OWN" : "RENTED";
        // Throws IllegalVehicleTransitionError for a sold car, one in the workshop, or a
        // leased-in car being put on a plain rental.
        assertTransition(contract.vehicle.status, vehicleTarget, contract.vehicle.ownershipType);

        const terms: ContractTerms = {
          startDate: fromDbDate(contract.startDate),
          durationMonths: contract.durationMonths,
          monthlyRental: contract.monthlyRentalFils,
          downPayment: contract.downPaymentFils,
          buyout: contract.buyoutFils,
          annualInsurance: contract.annualInsuranceFils,
          vatBasisPoints: contract.vatBasisPoints,
        };

        let installments = 0;
        for (const charge of chargesFor(terms)) {
          const row = await tx.contractCharge.create({
            data: {
              contractId,
              key: charge.key,
              chargeType: charge.chargeType,
              label: charge.label,
              recurrence: charge.recurrence,
              amountFils: charge.amount,
              startsOn: toDbDate(charge.startsOn),
              occurrences: charge.occurrences,
              vatBasisPoints: charge.vatBasisPoints,
            },
          });
          const expanded = expandCharge(charge, terms.durationMonths);
          await tx.installment.createMany({
            data: expanded.map((item) => ({
              contractId,
              chargeId: row.id,
              sequence: item.sequence,
              periodStart: toDbDate(item.periodStart),
              periodEnd: toDbDate(item.periodEnd),
              dueDate: toDbDate(item.dueDate),
              netFils: item.netFils,
              vatBasisPoints: item.vatBasisPoints,
              vatFils: item.vatFils,
              grossFils: item.grossFils,
            })),
          });
          installments += expanded.length;
        }

        // A leased-in car costs DrivenX its monthly lease for every month the customer has it
        // (P1D-13). Without the agreed cost there is nothing to write, and activating anyway
        // would report the whole rental as profit.
        const supplierId = contract.supplierId ?? contract.vehicle.supplierId;
        let supplierInvoices = 0;
        if (contract.vehicle.ownershipType === "B2B_SUPPLIER") {
          const monthlyCost = contract.vehicle.supplierMonthlyCostFils;
          if (!supplierId || monthlyCost === null || monthlyCost <= 0n) {
            throw new ContractRuleError("supplierCostMissing");
          }
          supplierInvoices = await writeSupplierSchedule(
            tx,
            {
              id: contractId,
              vehicleId: contract.vehicle.id,
              supplierId,
              startDate: terms.startDate,
              durationMonths: terms.durationMonths,
            },
            monthlyCost,
          );
        }

        const moved = await tx.vehicle.updateMany({
          where: { id: contract.vehicle.id, status: contract.vehicle.status },
          data: { status: vehicleTarget },
        });
        if (moved.count === 0) throw new ContractRuleError("vehicleOnLiveContract");
        await tx.vehicleStatusChange.create({
          data: {
            vehicleId: contract.vehicle.id,
            fromStatus: contract.vehicle.status,
            toStatus: vehicleTarget,
            reason: contract.number,
            changedById: options.actorId,
          },
        });

        await tx.contract.update({
          where: { id: contractId },
          data: { status: "ACTIVE", activatedAt: new Date() },
        });
        await tx.contractStatusChange.create({
          data: { contractId, fromStatus: contract.status, toStatus: "ACTIVE", changedById: options.actorId },
        });

        const issued = await issueDueForContract(tx, contract, options.today);
        const supplierRaised =
          supplierInvoices > 0 ? await raiseDueSupplierInvoicesForContract(tx, contractId, options.today) : 0;
        return { installments, issued, supplierInvoices, supplierRaised };
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    // The partial unique index (INV-9) is the last word on a car already on a live contract.
    if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002") {
      throw new ContractRuleError("vehicleOnLiveContract");
    }
    throw error;
  }
}

/**
 * Issue every instalment that has fallen due and not yet been issued — the nightly job's
 * work, and safe to run any number of times. Each contract is its own transaction, so one
 * failure does not hold up the rest.
 */
export async function issueDueInstallments(today: IsoDate): Promise<{ contracts: number; issued: number }> {
  const contracts = await prisma.contract.findMany({
    where: {
      status: { in: ["ACTIVE", "OVERDUE"] },
      deletedAt: null,
      installments: { some: { invoiceNumber: null, waivedAt: null, dueDate: { lte: toDbDate(today) } } },
    },
    select: { id: true, customerId: true, vehicleId: true, supplierId: true, number: true },
  });

  let issued = 0;
  for (const contract of contracts) {
    issued += await prisma.$transaction(
      async (tx) => {
        await lockContract(tx, contract.id);
        return issueDueForContract(tx, contract, today);
      },
      { timeout: 30_000 },
    );
  }
  return { contracts: contracts.length, issued };
}

// ---------------------------------------------------------------------------
// Payments, waivers and overdue (slice 2b)
// ---------------------------------------------------------------------------

/**
 * Bring a live contract's status in line with its instalments: Overdue while anything
 * issued is past due and unpaid, Active once nothing is.
 */
async function refreshContractStatus(
  tx: Tx,
  contractId: string,
  actorId: string | null,
): Promise<void> {
  const contract = await tx.contract.findUniqueOrThrow({ where: { id: contractId }, select: { status: true } });
  if (contract.status !== "ACTIVE" && contract.status !== "OVERDUE") return;

  const late = await tx.installment.count({ where: { contractId, status: "OVERDUE" } });
  const target: ContractStatus = late > 0 ? "OVERDUE" : "ACTIVE";
  if (target === contract.status) return;

  assertContractTransition(contract.status, target);
  await tx.contract.update({ where: { id: contractId }, data: { status: target } });
  await tx.contractStatusChange.create({
    data: { contractId, fromStatus: contract.status, toStatus: target, changedById: actorId },
  });
}

export interface NewPayment {
  /** Gross — what the customer handed over. */
  amountFils: bigint;
  receivedOn: IsoDate;
  method: PaymentMethod;
  reference?: string | null;
  notes?: string | null;
}

/**
 * Record a payment against a contract.
 *
 * Spread oldest-first across what is owed — including instalments not yet due, so a
 * customer who pays ahead has paid ahead. Anything beyond the whole outstanding balance is
 * kept as credit on the payment, never dropped (INV-2). A payment dated in the future is
 * refused; one dated in the past is accepted, because a cheque received last week is
 * recorded today.
 */
export async function recordPayment(
  contractId: string,
  payment: NewPayment,
  options: { actorId: string | null; today: IsoDate },
): Promise<{ paymentId: string; allocated: number; creditFils: bigint }> {
  if (payment.amountFils <= 0n) throw new ContractRuleError("invalidPayment");
  if (payment.receivedOn > options.today) throw new ContractRuleError("paymentInFuture");

  return prisma.$transaction(
    async (tx) => {
      await lockContract(tx, contractId);

      const contract = await tx.contract.findFirst({
        where: { id: contractId, deletedAt: null },
        select: { id: true, status: true, customerId: true },
      });
      if (!contract) throw new ContractRuleError("contractNotFound");
      if (!["ACTIVE", "OVERDUE", "COMPLETED"].includes(contract.status)) {
        throw new ContractRuleError("contractNotLive");
      }

      const open = await tx.installment.findMany({
        where: { contractId, waivedAt: null },
        select: { id: true, dueDate: true, sequence: true, grossFils: true, paidFils: true },
      });
      const { allocations, creditFils } = allocatePayment(
        payment.amountFils,
        open.map((item) => ({ ...item, dueDate: fromDbDate(item.dueDate), waived: false })),
      );

      const created = await tx.payment.create({
        data: {
          contractId,
          customerId: contract.customerId,
          receivedOn: toDbDate(payment.receivedOn),
          amountFils: payment.amountFils,
          method: payment.method,
          reference: payment.reference ?? null,
          notes: payment.notes ?? null,
          creditFils,
          recordedById: options.actorId,
        },
      });

      if (allocations.length > 0) {
        await tx.paymentAllocation.createMany({
          data: allocations.map((allocation) => ({ paymentId: created.id, ...allocation })),
        });
      }

      // The contract row is locked, so these reads and writes cannot interleave with
      // another payment on the same contract.
      for (const allocation of allocations) {
        const item = open.find((candidate) => candidate.id === allocation.installmentId)!;
        const paidFils = item.paidFils + allocation.amountFils;
        await tx.installment.update({
          where: { id: item.id },
          data: {
            paidFils,
            status: installmentStatus(
              { dueDate: fromDbDate(item.dueDate), grossFils: item.grossFils, paidFils, waived: false },
              options.today,
            ),
          },
        });
      }

      await refreshContractStatus(tx, contractId, options.actorId);
      return { paymentId: created.id, allocated: allocations.length, creditFils };
    },
    { timeout: 30_000 },
  );
}

/**
 * Forgive an unpaid instalment. A reason is required, and an instalment that has been
 * part-paid cannot be waived — that money has been applied, and forgiving the rest is a
 * different decision from forgiving the whole.
 *
 * If the instalment had already been issued its revenue is on the ledger, so a reversing
 * entry takes it back out, dated the day of the waiver. The original entry is never
 * touched (INV-7). One not yet issued simply never will be.
 */
export async function waiveInstallment(
  installmentId: string,
  options: { reason: string; actorId: string | null; today: IsoDate },
): Promise<void> {
  const reason = options.reason.trim();
  if (!reason) throw new ContractRuleError("waiveNeedsReason");

  const found = await prisma.installment.findUnique({ where: { id: installmentId }, select: { contractId: true } });
  if (!found) throw new ContractRuleError("installmentNotFound");

  await prisma.$transaction(async (tx) => {
    await lockContract(tx, found.contractId);

    const item = await tx.installment.findUniqueOrThrow({
      where: { id: installmentId },
      include: { contract: { select: { id: true, number: true, customerId: true, vehicleId: true, supplierId: true } } },
    });
    if (item.waivedAt) throw new ContractRuleError("alreadyWaived");
    if (item.paidFils > 0n) throw new ContractRuleError("waivePaidInstallment");

    await tx.installment.update({
      where: { id: installmentId },
      data: { waivedAt: new Date(), waiveReason: reason, waivedById: options.actorId, status: "WAIVED" },
    });

    if (item.invoiceNumber !== null) {
      const original = await tx.ledgerEntry.findFirst({
        where: { sourceType: "Installment", sourceId: installmentId, direction: "REVENUE" },
      });
      if (original) {
        await postToLedger(tx, {
          occurredOn: options.today,
          direction: "REVENUE",
          category: original.category,
          amountFils: -original.amountFils,
          vehicleId: item.contract.vehicleId,
          contractId: item.contract.id,
          customerId: item.contract.customerId,
          supplierId: item.contract.supplierId,
          sourceType: "InstallmentWaiver",
          sourceId: installmentId,
          reversesId: original.id,
          memo: reason,
        });
      }
    }

    await refreshContractStatus(tx, item.contractId, options.actorId);
  });
}

/**
 * The nightly overdue pass (P1D-09): issued instalments past their due date and not paid
 * become Overdue, and so does any live contract carrying one. Run after issuing, so what
 * fell due yesterday is already issued.
 */
export async function refreshOverdue(today: IsoDate): Promise<{ installments: number; contracts: number }> {
  const { count } = await prisma.installment.updateMany({
    where: {
      invoiceNumber: { not: null },
      waivedAt: null,
      dueDate: { lt: toDbDate(today) },
      status: { in: ["DUE", "PARTIALLY_PAID", "UPCOMING"] },
    },
    data: { status: "OVERDUE" },
  });

  const affected = await prisma.contract.findMany({
    where: { status: "ACTIVE", deletedAt: null, installments: { some: { status: "OVERDUE" } } },
    select: { id: true },
  });
  for (const contract of affected) {
    await prisma.$transaction(async (tx) => {
      await lockContract(tx, contract.id);
      await refreshContractStatus(tx, contract.id, null);
    });
  }

  return { installments: count, contracts: affected.length };
}
