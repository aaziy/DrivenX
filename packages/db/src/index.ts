/**
 * @drivenx/db — Prisma client and generated types.
 *
 * The exported client is wrapped in the audit extension (P0-09), so every mutation
 * writes an audit row automatically. Application code should never construct its own
 * PrismaClient: one built directly would bypass auditing entirely.
 *
 * The client is a module-level singleton. Next.js dev-mode hot reload re-evaluates
 * modules on every change, and a fresh PrismaClient per reload exhausts the Postgres
 * connection pool within minutes, so in non-production we stash it on globalThis.
 */

import { createAuditExtension } from "./audit/extension";
import { PrismaClient } from "../generated/client";

function createClient() {
  // Query logging is opt-in even in development: genuinely useful when tuning a
  // report, unreadable noise everywhere else (seeds, migrations, test runs).
  const logQueries = process.env.PRISMA_LOG_QUERIES === "true";

  const base = new PrismaClient({
    log: logQueries ? ["query", "warn", "error"] : ["warn", "error"],
  });

  // The extension reads and writes through `base`, so audit reads and the audit
  // insert itself are never re-intercepted.
  return base.$extends(createAuditExtension(base));
}

export type DrivenxPrismaClient = ReturnType<typeof createClient>;

const globalForPrisma = globalThis as unknown as {
  drivenxPrisma?: DrivenxPrismaClient;
};

export const prisma: DrivenxPrismaClient = globalForPrisma.drivenxPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.drivenxPrisma = prisma;
}

export * from "../generated/client";
export { nextCustomerCode, nextSupplierCode, nextVehicleCode } from "./parties/codes";
export {
  changeVehicleStatus,
  ConcurrentVehicleChangeError,
  createVehicle,
  MileageRejectedError,
  recordMileage,
  VehicleNotFoundError,
  VehicleStatusManagedByContractError,
  type NewVehicle,
} from "./fleet";
export {
  activateContract,
  ContractRuleError,
  createContract,
  issueDueInstallments,
  nextInvoiceNumber,
  recordPayment,
  refreshOverdue,
  waiveInstallment,
  type ContractRuleCode,
  type NewContract,
  type NewPayment,
} from "./contracts";
export { reconcile, type Violation } from "./reconcile";
export { fromDbDate, toDbDate } from "./dates";
export { postToLedger, type LedgerPosting } from "./ledger";
export {
  globalSearch,
  type SearchHit,
  type SearchKind,
  type SearchOptions,
} from "./search";
export {
  withAuditContext,
  withoutAudit,
  currentAuditActor,
  isAuditSuppressed,
  type AuditActor,
} from "./audit/context";
