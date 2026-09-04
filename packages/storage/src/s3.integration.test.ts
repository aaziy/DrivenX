/**
 * P0-10 integration tests — real MinIO, no mocks.
 *
 * Plan requirement: "upload/retrieve round-trip; oversized rejected; .exe rejected".
 * The rejection cases are unit tested in validation.test.ts; this file covers the
 * parts only a real object store can prove — that bytes survive intact, that signed
 * URLs work and expire, and that the bucket is genuinely private.
 */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ObjectNotFoundError } from "./adapter";
import { type S3Storage, s3StorageFromEnv } from "./s3";

const PDF_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, ...new Array(256).fill(0x41),
]);

const prefix = `test-run/${randomUUID()}`;
const createdKeys: string[] = [];

let storage: S3Storage;

function keyFor(name: string): string {
  const key = `${prefix}/${name}`;
  createdKeys.push(key);
  return key;
}

beforeAll(() => {
  storage = s3StorageFromEnv();
});

afterAll(async () => {
  await Promise.all(createdKeys.map((key) => storage.delete(key).catch(() => undefined)));
});

describe("S3Storage round-trip [P0-10]", () => {
  it("stores and retrieves bytes unchanged", async () => {
    const key = keyFor("round-trip.pdf");

    const stored = await storage.put({
      key,
      bytes: PDF_BYTES,
      mimeType: "application/pdf",
      fileName: "emirates-id.pdf",
    });

    expect(stored.sizeBytes).toBe(PDF_BYTES.byteLength);

    const retrieved = await storage.get(key);
    expect(retrieved.byteLength).toBe(PDF_BYTES.byteLength);
    expect(Buffer.from(retrieved).equals(Buffer.from(PDF_BYTES))).toBe(true);
  });

  it("reports existence accurately", async () => {
    const key = keyFor("exists.pdf");
    expect(await storage.exists(key)).toBe(false);

    await storage.put({ key, bytes: PDF_BYTES, mimeType: "application/pdf", fileName: "x.pdf" });
    expect(await storage.exists(key)).toBe(true);
  });

  it("throws ObjectNotFoundError rather than a raw SDK error", async () => {
    await expect(storage.get(`${prefix}/missing.pdf`)).rejects.toThrow(ObjectNotFoundError);
  });

  it("deletes, and deleting again is not an error", async () => {
    const key = keyFor("deletable.pdf");
    await storage.put({ key, bytes: PDF_BYTES, mimeType: "application/pdf", fileName: "x.pdf" });

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);

    // Removing an already-removed document should not fail a cleanup path.
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  it("preserves a sanitised filename in Content-Disposition", async () => {
    const key = keyFor("disposition.pdf");
    await storage.put({
      key,
      bytes: PDF_BYTES,
      mimeType: "application/pdf",
      // A header-injection attempt in the filename.
      fileName: 'id".pdf"; attachment; filename="evil.exe',
    });

    const response = await fetch(await storage.signedUrl(key));
    const disposition = response.headers.get("content-disposition") ?? "";

    // Two distinct properties: the header cannot be broken out of, and the browser
    // cannot be induced to save the file with an executable extension.
    expect(disposition).not.toContain(".exe");
    expect(disposition).toMatch(/^inline; filename="[^"]*"; filename\*=UTF-8''/);
    expect(response.headers.get("content-type")).toBe("application/pdf");
  });
});

describe("signed URLs [P0-10]", () => {
  it("grants temporary read access", async () => {
    const key = keyFor("signed.pdf");
    await storage.put({ key, bytes: PDF_BYTES, mimeType: "application/pdf", fileName: "x.pdf" });

    const response = await fetch(await storage.signedUrl(key));
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer()).byteLength).toBe(PDF_BYTES.byteLength);
  });

  it("stops working once expired", async () => {
    const key = keyFor("expiring.pdf");
    await storage.put({ key, bytes: PDF_BYTES, mimeType: "application/pdf", fileName: "x.pdf" });

    const url = await storage.signedUrl(key, { expiresInSeconds: 1 });
    expect((await fetch(url)).status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 1500));

    // These links reach Emirates IDs and passports; one pasted into a chat must not
    // still work tomorrow.
    expect((await fetch(url)).status).toBe(403);
  });

  it("does not grant access to a different object", async () => {
    const granted = keyFor("granted.pdf");
    const other = keyFor("other.pdf");
    await storage.put({
      key: granted,
      bytes: PDF_BYTES,
      mimeType: "application/pdf",
      fileName: "x.pdf",
    });
    await storage.put({
      key: other,
      bytes: PDF_BYTES,
      mimeType: "application/pdf",
      fileName: "y.pdf",
    });

    const url = await storage.signedUrl(granted);
    const tampered = url.replace("granted.pdf", "other.pdf");

    expect((await fetch(tampered)).status).toBe(403);
  });

  it("can force a download instead of inline rendering", async () => {
    const key = keyFor("download.pdf");
    await storage.put({ key, bytes: PDF_BYTES, mimeType: "application/pdf", fileName: "x.pdf" });

    const response = await fetch(await storage.signedUrl(key, { download: true }));
    expect(response.headers.get("content-disposition")).toContain("attachment");
  });
});

describe("bucket privacy [P0-10]", () => {
  it("refuses unsigned access", async () => {
    const key = keyFor("private.pdf");
    await storage.put({ key, bytes: PDF_BYTES, mimeType: "application/pdf", fileName: "x.pdf" });

    // Strip the signature: customer documents must never be readable by URL guess.
    const unsigned = (await storage.signedUrl(key)).split("?")[0]!;
    const response = await fetch(unsigned);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});

describe("s3StorageFromEnv", () => {
  it("throws on missing configuration rather than defaulting", () => {
    // A silently misconfigured bucket means uploads that look fine and documents
    // that cannot be found later.
    expect(() => s3StorageFromEnv({ S3_REGION: "me-central-1" })).toThrow(/S3_BUCKET/);
    expect(() => s3StorageFromEnv({})).toThrow(/Storage misconfigured/);
  });
});
