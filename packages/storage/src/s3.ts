/**
 * S3-compatible storage adapter.
 *
 * Runs against a local S3-compatible server in development and CI, and any S3-compatible
 * provider in production. The only difference between them is configuration.
 * `forcePathStyle` addresses buckets as `host/bucket` rather than `bucket.host`, which
 * has no DNS entry locally.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  ObjectNotFoundError,
  type PutObjectInput,
  type SignedUrlOptions,
  type StorageAdapter,
  type StoredObject,
} from "./adapter";
import { contentDisposition } from "./validation";

export interface S3StorageConfig {
  endpoint?: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean | undefined;
}

const DEFAULT_SIGNED_URL_SECONDS = 300; // 5 minutes

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata
    ?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

/**
 * The one place configuration becomes a client, so the adapter and bucket setup cannot
 * drift into talking to the server differently.
 */
export function buildS3Client(config: S3StorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle ?? false,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export class S3Storage implements StorageAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.client = buildS3Client(config);
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.bytes,
        // The sniffed type, never the client-declared one. Serving an uploaded file
        // back under an attacker-chosen Content-Type is how stored XSS happens.
        ContentType: input.mimeType,
        ContentDisposition: contentDisposition("inline", input.fileName, input.mimeType),
      }),
    );

    return {
      key: input.key,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
    };
  }

  async get(key: string): Promise<Uint8Array> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!response.Body) throw new ObjectNotFoundError(key);
      return await response.Body.transformToByteArray();
    } catch (error) {
      if (isNotFound(error)) throw new ObjectNotFoundError(key);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    // S3 delete is idempotent and does not report a missing key; that suits us, since
    // removing an already-removed document is not an error worth surfacing.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async signedUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(options.download ? { ResponseContentDisposition: "attachment" } : {}),
    });

    return getSignedUrl(this.client, command, {
      expiresIn: options.expiresInSeconds ?? DEFAULT_SIGNED_URL_SECONDS,
    });
  }
}

/**
 * Read storage configuration from the environment.
 *
 * Throws on missing values rather than defaulting: a silently misconfigured bucket
 * means uploads that appear to succeed and documents that cannot be retrieved later.
 */
export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3StorageConfig {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`Storage misconfigured: ${name} is not set.`);
    return value;
  };

  return {
    endpoint: env["S3_ENDPOINT"],
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    forcePathStyle: env["S3_FORCE_PATH_STYLE"] === "true",
  };
}

export function s3StorageFromEnv(env: NodeJS.ProcessEnv = process.env): S3Storage {
  return new S3Storage(s3ConfigFromEnv(env));
}
