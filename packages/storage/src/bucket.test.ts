import { CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { BucketSetupError, ensureBucket, type S3Sender } from "./bucket";

type Step = (command: unknown) => unknown;

function awsError(name: string, status?: number): Error {
  return Object.assign(new Error(name), {
    name,
    ...(status ? { $metadata: { httpStatusCode: status } } : {}),
  });
}

function refused(): Error {
  return Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9000"), { code: "ECONNREFUSED" });
}

const ok: Step = () => ({});
const fail =
  (error: Error): Step =>
  () => {
    throw error;
  };

/** A scripted stand-in for S3Client: each call consumes the next step. */
function fakeS3(...script: Step[]) {
  const calls: unknown[] = [];
  const sender = {
    async send(command: unknown) {
      calls.push(command);
      const step = script.shift();
      if (!step) throw new Error("unexpected extra call to S3");
      return step(command);
    },
  };
  return { calls, s3: sender as unknown as S3Sender };
}

function fakeClock() {
  let elapsed = 0;
  return {
    now: () => elapsed,
    sleep: async (ms: number) => {
      elapsed += ms;
    },
    elapsed: () => elapsed,
  };
}

const target = { bucket: "drivenx-documents", region: "me-central-1" };

describe("ensureBucket", () => {
  it("does nothing when the bucket already exists", async () => {
    const { s3, calls } = fakeS3(ok);

    await expect(ensureBucket(s3, target)).resolves.toBe("exists");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeInstanceOf(HeadBucketCommand);
  });

  it("creates a missing bucket with a location constraint outside us-east-1", async () => {
    const { s3, calls } = fakeS3(fail(awsError("NotFound", 404)), ok);

    await expect(ensureBucket(s3, target)).resolves.toBe("created");
    const create = calls[1] as CreateBucketCommand;
    expect(create).toBeInstanceOf(CreateBucketCommand);
    expect(create.input.CreateBucketConfiguration?.LocationConstraint).toBe("me-central-1");
  });

  it("omits the location constraint in us-east-1, where real S3 rejects one", async () => {
    const { s3, calls } = fakeS3(fail(awsError("NotFound", 404)), ok);

    await ensureBucket(s3, { ...target, region: "us-east-1" });
    expect((calls[1] as CreateBucketCommand).input.CreateBucketConfiguration).toBeUndefined();
  });

  it("retries without the constraint when the server does not support regions", async () => {
    const { s3, calls } = fakeS3(
      fail(awsError("NotFound", 404)),
      fail(awsError("InvalidRegion", 400)),
      ok,
    );

    await expect(ensureBucket(s3, target)).resolves.toBe("created");
    expect((calls[2] as CreateBucketCommand).input.CreateBucketConfiguration).toBeUndefined();
  });

  it("treats a bucket created concurrently by the same account as existing", async () => {
    const { s3 } = fakeS3(
      fail(awsError("NotFound", 404)),
      fail(awsError("BucketAlreadyOwnedByYou", 409)),
    );

    await expect(ensureBucket(s3, target)).resolves.toBe("exists");
  });

  it("refuses a bucket name that another account owns", async () => {
    // On real S3 this means someone else holds the name. Carrying on would point every
    // upload at a bucket DrivenX does not control.
    const { s3 } = fakeS3(
      fail(awsError("NotFound", 404)),
      fail(awsError("BucketAlreadyExists", 409)),
    );

    await expect(ensureBucket(s3, target)).rejects.toThrow(BucketSetupError);
  });

  it("waits for a server that is still starting", async () => {
    const clock = fakeClock();
    const { s3, calls } = fakeS3(fail(refused()), fail(refused()), ok);

    await expect(
      ensureBucket(s3, target, { now: clock.now, sleep: clock.sleep, intervalMs: 1000 }),
    ).resolves.toBe("exists");
    expect(calls).toHaveLength(3);
    expect(clock.elapsed()).toBe(2000);
  });

  it("gives up at the deadline and reports the last error", async () => {
    const clock = fakeClock();
    const { s3 } = fakeS3(...Array.from({ length: 10 }, () => fail(refused())));

    const attempt = ensureBucket(s3, target, {
      now: clock.now,
      sleep: clock.sleep,
      intervalMs: 1000,
      timeoutMs: 3000,
    });

    await expect(attempt).rejects.toThrow(BucketSetupError);
    await expect(attempt).rejects.toThrow(/ECONNREFUSED/);
  });

  it("fails immediately on rejected credentials instead of waiting out the timeout", async () => {
    const clock = fakeClock();
    const { s3, calls } = fakeS3(fail(awsError("Forbidden", 403)));

    await expect(
      ensureBucket(s3, target, { now: clock.now, sleep: clock.sleep }),
    ).rejects.toThrow(/S3_ACCESS_KEY_ID/);
    expect(calls).toHaveLength(1);
    expect(clock.elapsed()).toBe(0);
  });

  it("surfaces an unexpected create error rather than swallowing it", async () => {
    const { s3 } = fakeS3(fail(awsError("NotFound", 404)), fail(awsError("InternalError", 500)));

    await expect(ensureBucket(s3, target)).rejects.toThrow("InternalError");
  });
});
