/**
 * Create the documents bucket if it does not exist yet.
 *
 * Runs in CI once the S3 server has started, and on any fresh development machine:
 *
 *   pnpm storage:ensure-bucket
 *
 * Waits up to 90 seconds for the server to start answering, so it can run straight
 * after the container starts without a separate health check.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { ensureBucket } from "../src/bucket";
import { buildS3Client, s3ConfigFromEnv } from "../src/s3";

const rootEnv = resolve(import.meta.dirname, "../../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config = s3ConfigFromEnv();
const result = await ensureBucket(buildS3Client(config), config, { timeoutMs: 90_000 });

console.log(
  `Bucket "${config.bucket}" at ${config.endpoint ?? "the default AWS endpoint"}: ${result}.`,
);
