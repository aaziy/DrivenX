/**
 * Job entry point.
 *
 * Runs one job and exits, rather than holding a long-lived scheduler process. The host's
 * cron decides when — that is one less thing to keep alive on a single VPS, and a job
 * that fails is visible in cron's output instead of dying quietly inside a daemon nobody
 * is watching.
 *
 *   pnpm --filter @drivenx/worker expiry-scan
 */

import { prisma } from "@drivenx/db";
import { logger } from "@drivenx/logger";

import { runContractsDailyLogged } from "./contracts-daily";
import { runDeliverNotificationsLogged } from "./deliver-notifications";
import { runExpiryScanLogged } from "./expiry-scan";
import { runMaintenanceDueLogged } from "./maintenance-due";

const JOBS = {
  "expiry-scan": runExpiryScanLogged,
  "contracts-daily": runContractsDailyLogged,
  "maintenance-due": runMaintenanceDueLogged,
  "deliver-notifications": runDeliverNotificationsLogged,
} as const;

type JobName = keyof typeof JOBS;

function isJobName(value: string | undefined): value is JobName {
  return value !== undefined && value in JOBS;
}

async function main(): Promise<void> {
  const requested = process.argv[2];

  if (!isJobName(requested)) {
    logger.error("unknown job", { requested, available: Object.keys(JOBS) });
    process.exitCode = 2;
    return;
  }

  await JOBS[requested]();
}

try {
  await main();
} catch (error) {
  // A non-zero exit is what makes cron surface the failure rather than swallow it.
  logger.error("job failed", { error });
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
