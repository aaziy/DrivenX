/**
 * Apply migrations to the integration-test database.
 *
 * Works both locally (reads TEST_DATABASE_URL from .env) and in CI (where no .env
 * exists and DATABASE_URL already points at the test database).
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!url) {
  console.error("Set TEST_DATABASE_URL (or DATABASE_URL) before running test migrations.");
  process.exit(1);
}

if (!/_test(\?|$)/.test(url)) {
  console.error(
    `Refusing to migrate: "${url.replace(/:\/\/[^@]*@/, "://***@")}" does not name a *_test database.`,
  );
  process.exit(1);
}

execSync("prisma migrate deploy --schema packages/db/prisma/schema.prisma", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
