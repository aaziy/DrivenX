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

import type { ContractType } from "../generated/client";
import type { Tx } from "./tx";
import { fromDbDate, toDbDate } from "./dates";
import { prisma } from "./index";
import { postToLedger } from "./ledger";

export type ContractRuleCode =
  | "customerNotFound"
  | "customerBlacklisted"
  | "vehicleNotFound"
  | "leasedCarNotLeaseToOwn"
  | "buyoutOnlyOnLeaseToOwn"
  | "invalidTerms"
  | "contractNotFound"
  | "vehicleOnLiveContract";

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
): Promise<{ installments: number; issued: number }> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await lockContract(tx, contractId);

        const contract = await tx.contract.findFirst({
          where: { id: contractId, deletedAt: null },
          include: {
            customer: { select: { status: true } },
            vehicle: { select: { id: true, status: true, ownershipType: true } },
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
        return { installments, issued };
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
