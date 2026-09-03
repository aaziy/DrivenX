/**
 * @drivenx/db — Prisma client and generated types.
 *
 * The client is a module-level singleton. Next.js dev-mode hot reload re-evaluates
 * modules on every change, and a fresh PrismaClient per reload exhausts the Postgres
 * connection pool within a few minutes, so in non-production we stash it on
 * globalThis and reuse it.
 */

import { PrismaClient } from "../generated/client/index.js";

const globalForPrisma = globalThis as unknown as {
  drivenxPrisma?: PrismaClient;
};

function createClient(): PrismaClient {
  // Query logging is opt-in even in development: it is genuinely useful when tuning a
  // report, and unreadable noise everywhere else (seeds, migrations, test runs).
  const logQueries = process.env.PRISMA_LOG_QUERIES === "true";

  return new PrismaClient({
    log: logQueries ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.drivenxPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.drivenxPrisma = prisma;
}

export * from "../generated/client/index.js";
