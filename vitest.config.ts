import { existsSync } from "node:fs";

import { defineConfig } from "vitest/config";

// Node 20.12+ built-in — avoids a dotenv dependency just to reach TEST_DATABASE_URL.
if (existsSync(".env")) process.loadEnvFile(".env");

/**
 * Integration and reconciliation tests point at TEST_DATABASE_URL, never DATABASE_URL.
 * The harness also refuses to run unless the URL names a *_test database, because
 * these suites truncate every table (packages/db/src/testing.ts).
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "";

const databaseProject = {
  environment: "node" as const,
  // No `passWithNoTests` here. Like `fileParallelism` below, it is a root-level option
  // that Vitest silently ignores inside a project, so an empty project still exits 1.
  // That failed the reconciliation step in CI; the flag now lives on that one script,
  // and should be dropped from it once P1D-14 adds the first reconciliation test.
  /**
   * These files truncate shared tables, so two running at once will delete each
   * other's fixtures mid-test.
   *
   * `fileParallelism: false` does NOT work here — it is a root-level option and is
   * ignored inside a project config, which shows up as non-deterministic failures
   * that vanish when you run either file on its own. `singleFork` is project-scoped
   * and genuinely serialises the files, while leaving the unit project parallel.
   */
  poolOptions: { forks: { singleFork: true } },
  setupFiles: ["./packages/db/src/testing-setup.ts"],
  env: { DATABASE_URL: testDatabaseUrl },
};

/**
 * Three test projects mirroring IMPLEMENTATION_PLAN.md §2.2.
 *
 * `unit` runs on every save — nothing in it touches a database or the network.
 * `integration` covers every write path. `reconciliation` holds the financial
 * invariants (§2.3) and comes online with the ledger in P1D-14.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts"],
          exclude: ["**/*.integration.test.ts", "**/*.reconciliation.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          ...databaseProject,
          name: "integration",
          include: [
            "packages/*/src/**/*.integration.test.ts",
            "apps/*/src/**/*.integration.test.ts",
          ],
        },
      },
      {
        test: {
          ...databaseProject,
          name: "reconciliation",
          include: ["packages/*/src/**/*.reconciliation.test.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["packages/core/src/**/*.ts", "packages/auth/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts"],
      thresholds: {
        // The domain layer — §2.2 targets 90%.
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
