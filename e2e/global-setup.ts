import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Bring the E2E database to a known state before the suite runs.
 *
 * Migrations, the base seed (permissions and roles) and the golden dataset (one staff
 * account per SOW §2 role). Every spec signs in as a golden persona rather than
 * creating its own user, so the suite documents what each role can actually reach.
 */
export default function globalSetup(): void {
  if (existsSync(".env")) process.loadEnvFile(".env");

  const databaseUrl = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("Set TEST_DATABASE_URL before running E2E tests.");
  }

  if (!/_test(\?|$)/.test(databaseUrl)) {
    // These specs create users and rewrite role permissions. Against a development or
    // production database that is data loss, not a test run.
    throw new Error(
      `Refusing to run E2E: "${databaseUrl.replace(/:\/\/[^@/]*@/, "://***@")}" is not a *_test database.`,
    );
  }

  const env = { ...process.env, DATABASE_URL: databaseUrl };
  const run = (command: string) => execSync(command, { stdio: "inherit", env });

  run("pnpm db:migrate:test");
  run("tsx packages/db/prisma/seed.ts");
  run("tsx packages/db/prisma/seed-golden.ts");
}
