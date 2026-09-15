/**
 * Make sure the documents bucket exists, in development, CI and on first deploy.
 *
 * This replaces a one-shot container running MinIO's `mc` command-line tool. Docker Hub
 * stopped serving both MinIO images that approach depended on, so a fresh CI runner
 * could not pull them. A development machine still had them cached, and every local
 * run kept passing while CI failed on every push. Bucket setup now goes through the
 * AWS SDK the application already uses, which works against any S3-compatible server.
 */

import {
  type BucketLocationConstraint,
  CreateBucketCommand,
  HeadBucketCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

export type S3Sender = Pick<S3Client, "send">;

export type EnsureBucketResult = "created" | "exists";

export interface EnsureBucketTarget {
  bucket: string;
  region: string;
}

export interface EnsureBucketOptions {
  /** How long to keep retrying while the server starts. Default 60 seconds. */
  timeoutMs?: number;
  /** Delay between attempts. Default 1 second. */
  intervalMs?: number;
  /** Injected for tests. */
  now?: () => number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export class BucketSetupError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BucketSetupError";
  }
}

const statusOf = (error: unknown): number | undefined =>
  (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;

const nameOf = (error: unknown): string => (error as { name?: string } | null)?.name ?? "";

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

export async function ensureBucket(
  s3: S3Sender,
  target: EnsureBucketTarget,
  options: EnsureBucketOptions = {},
): Promise<EnsureBucketResult> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 1_000;
  const deadline = now() + timeoutMs;

  let lastError: unknown;

  for (;;) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: target.bucket }));
      return "exists";
    } catch (error) {
      const status = statusOf(error);

      if (status === 404 || nameOf(error) === "NotFound" || nameOf(error) === "NoSuchBucket") {
        return createBucket(s3, target);
      }

      // Waiting will not fix wrong credentials, and a minute of silent retries before
      // saying so turns a simple misconfiguration into a mystery.
      if (status === 401 || status === 403) {
        throw new BucketSetupError(
          `The S3 server rejected the credentials for bucket "${target.bucket}" (HTTP ${status}). ` +
            "Check S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.",
          { cause: error },
        );
      }

      // Connection refused, or a 5xx while the server is still starting: try again.
      lastError = error;
    }

    if (now() >= deadline) {
      throw new BucketSetupError(
        `The S3 server did not answer within ${Math.round(timeoutMs / 1000)}s. ` +
          `Last error: ${describeError(lastError)}`,
        { cause: lastError },
      );
    }
    await sleep(intervalMs);
  }
}

async function sendCreate(
  s3: S3Sender,
  bucket: string,
  constraint: BucketLocationConstraint | undefined,
): Promise<void> {
  await s3.send(
    new CreateBucketCommand({
      Bucket: bucket,
      ...(constraint ? { CreateBucketConfiguration: { LocationConstraint: constraint } } : {}),
    }),
  );
}

async function createBucket(s3: S3Sender, target: EnsureBucketTarget): Promise<EnsureBucketResult> {
  // Real S3 requires a location constraint outside us-east-1 and rejects one inside it.
  const constraint =
    target.region === "us-east-1" ? undefined : (target.region as BucketLocationConstraint);

  try {
    await sendCreate(s3, target.bucket, constraint);
    return "created";
  } catch (error) {
    if (constraint && /location|region/i.test(nameOf(error))) {
      // Several S3-compatible servers have no notion of regions and reject the
      // constraint real S3 insists on. Retry once without it.
      try {
        await sendCreate(s3, target.bucket, undefined);
        return "created";
      } catch (retryError) {
        return settleCreateError(retryError, target);
      }
    }
    return settleCreateError(error, target);
  }
}

function settleCreateError(error: unknown, target: EnsureBucketTarget): EnsureBucketResult {
  const name = nameOf(error);

  // Created between our HEAD and CREATE by another process on the same account.
  if (name === "BucketAlreadyOwnedByYou") return "exists";

  if (name === "BucketAlreadyExists") {
    throw new BucketSetupError(
      `Bucket "${target.bucket}" already exists under a different account. Choose another ` +
        "S3_BUCKET: carrying on would send every upload to a bucket DrivenX does not control.",
      { cause: error },
    );
  }

  throw error;
}
