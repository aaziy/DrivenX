/**
 * The storage port.
 *
 * SOW §20 requires DrivenX to own their hosting outright, and §18 leaves the door open
 * to changing providers. Every call site depends on this interface rather than on the
 * AWS SDK, so moving from MinIO to S3, Cloudflare R2 or a UAE-hosted equivalent is a
 * configuration change plus one adapter — not a search through the codebase.
 */

import type { AllowedMimeType } from "./validation.js";

export interface StoredObject {
  key: string;
  mimeType: AllowedMimeType;
  sizeBytes: number;
}

export interface PutObjectInput {
  key: string;
  bytes: Uint8Array;
  mimeType: AllowedMimeType;
  /** Original filename, echoed in Content-Disposition on download. */
  fileName: string;
}

export interface SignedUrlOptions {
  /**
   * Seconds until the link stops working. Kept short by default: these URLs grant
   * unauthenticated access to Emirates IDs and passports, and a link pasted into a
   * chat should not still work tomorrow.
   */
  expiresInSeconds?: number;
  /** Force a download rather than inline rendering. */
  download?: boolean;
}

export interface StorageAdapter {
  put(input: PutObjectInput): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  signedUrl(key: string, options?: SignedUrlOptions): Promise<string>;
}

export class ObjectNotFoundError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`Object not found: ${key}`);
    this.name = "ObjectNotFoundError";
    this.key = key;
  }
}
