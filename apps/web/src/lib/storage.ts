/**
 * The storage client for the web app.
 *
 * One instance, for the same reason the Prisma client is one instance: the S3 client
 * holds connection pools, and building one per request leaks sockets until the process
 * runs out. Next.js dev-mode hot reload re-evaluates modules on every change, so in
 * non-production it is stashed on globalThis rather than rebuilt on each reload.
 *
 * Built lazily, not at module load: importing this file must not throw because an
 * environment variable is missing, or every page that happens to import it fails
 * instead of the one operation that actually needs storage.
 */

import { DEFAULT_MAX_UPLOAD_BYTES, s3StorageFromEnv, type StorageAdapter } from "@drivenx/storage";

/**
 * The upload size cap, read once from the environment.
 *
 * Both the form's "up to N MB" hint and the server-side check read this. Two separate
 * readings drift, and the form then promises a limit the server refuses — which the
 * person discovers only after waiting for a large file to finish uploading.
 */
export function maxUploadBytes(): number {
  const configured = Number(process.env["S3_MAX_UPLOAD_BYTES"]);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_UPLOAD_BYTES;
}

const globalForStorage = globalThis as unknown as {
  drivenxStorage?: StorageAdapter;
};

export function storage(): StorageAdapter {
  const existing = globalForStorage.drivenxStorage;
  if (existing) return existing;

  const created = s3StorageFromEnv();
  globalForStorage.drivenxStorage = created;
  return created;
}
