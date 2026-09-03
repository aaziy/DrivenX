/**
 * Integration test harness (IMPLEMENTATION_PLAN.md §2.2).
 *
 * Tests run against a real Postgres, never a mock. The bugs worth catching here —
 * constraint violations, cascade behaviour, rounding inside aggregates, concurrent
 * invoice numbering — only exist against the real engine.
 *
 * Isolation strategy: truncate between tests rather than transaction-rollback. Our
 * domain functions import the `prisma` singleton directly, so a rollback approach
 * would require threading a transaction client through every signature. Truncation
 * costs a few milliseconds and keeps the production code honest — it exercises the
 * same client path the app uses. `fileParallelism` is disabled for these projects so
 * concurrent files cannot truncate each other's data.
 */

import { prisma } from "./index.js";
import { isTestDatabaseUrl, redactUrl } from "./test-guard.js";

/**
 * Tables are discovered from the catalogue rather than hard-coded.
 *
 * Milestones 1A–1D add roughly twenty tables; a hand-maintained list would silently
 * stop truncating the newest one and leak state between tests — which surfaces as a
 * flaky failure in an unrelated suite days later.
 */
async function tableNames(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE '\\_prisma%'
  `;
  return rows.map((row) => row.tablename);
}

let cachedTables: string[] | null = null;

/** Remove all data. Identity sequences restart so IDs are comparable across tests. */
export async function truncateAll(): Promise<void> {
  cachedTables ??= await tableNames();
  if (cachedTables.length === 0) return;

  const quoted = cachedTables.map((name) => `"public"."${name}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
}

/**
 * Guard against a catastrophic misconfiguration: if DATABASE_URL somehow points at a
 * non-test database, truncating every table would destroy real data. Called once at
 * setup.
 */
export function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!isTestDatabaseUrl(url)) {
    throw new Error(
      `Refusing to run integration tests: DATABASE_URL does not name a *_test database.\n` +
        `Got: ${redactUrl(url)}\n` +
        `These tests TRUNCATE every table. Set TEST_DATABASE_URL in .env.`,
    );
  }
}

export { prisma };
