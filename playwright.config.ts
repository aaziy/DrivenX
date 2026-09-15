import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

if (existsSync(".env")) process.loadEnvFile(".env");

/**
 * E2E configuration (P0-14).
 *
 * Deliberately thin — IMPLEMENTATION_PLAN.md §2.2 puts roughly a dozen journeys here
 * and nothing more. E2E is slow and brittle; it exists to prove the wiring holds, not
 * the logic. Logic is tested one layer down, where a failure names the function rather
 * than the page.
 *
 * Runs against TEST_DATABASE_URL, never the development database. These specs create
 * users and change role permissions; pointing them at dev data would quietly corrupt
 * whatever someone was working on.
 */

const PORT = Number(process.env["E2E_PORT"] ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const databaseUrl = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"] ?? "";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",

  // One worker, no parallelism: every spec shares one database and one signed-in
  // application. Parallel workers would race on role permissions.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },

  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    timezoneId: "Asia/Dubai",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  globalSetup: "./e2e/global-setup.ts",

  webServer: {
    command: "pnpm --filter @drivenx/web dev",
    url: BASE_URL,
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PORT: String(PORT),
      DATABASE_URL: databaseUrl,
      AUTH_SECRET: process.env["AUTH_SECRET"] ?? "e2e-only-secret-not-for-any-deployment",
      NODE_ENV: "development",
      LOG_LEVEL: "warn",
    },
  },
});
