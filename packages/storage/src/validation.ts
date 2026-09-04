/**
 * Upload validation (P0-10).
 *
 * Pure functions, no I/O — the security decisions live here and are unit tested
 * without needing a bucket.
 *
 * Central rule: **the client-declared Content-Type is never trusted.** It is
 * attacker-controlled, so rejecting an executable by its declared type or its file
 * extension is security theatre — renaming `payload.exe` to `passport.pdf` defeats
 * both. Every upload is sniffed from its magic bytes, and the sniffed type is what
 * gets stored, served and validated.
 */

import { randomUUID } from "node:crypto";

/** 10 MiB. Overridable via S3_MAX_UPLOAD_BYTES. */
export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Allowlist, not blocklist. These cover what SOW §6 and §11 actually require:
 * Emirates ID, driving licence, passport, visa, trade licence, mulkiya, insurance
 * policies and signed contracts — scans and phone photos.
 *
 * HEIC is included deliberately: it is the iPhone camera default, and omitting it
 * means every staff member photographing a document on an iPhone hits a rejection.
 */
export const ALLOWED_MIME_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
} as const;

export type AllowedMimeType = keyof typeof ALLOWED_MIME_TYPES;

export function isAllowedMimeType(type: string): type is AllowedMimeType {
  return type in ALLOWED_MIME_TYPES;
}

export function extensionFor(type: AllowedMimeType): string {
  return ALLOWED_MIME_TYPES[type];
}

// ---------------------------------------------------------------------------
// Content sniffing
// ---------------------------------------------------------------------------

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return "";
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** HEIF-family brands that are image containers we accept. */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/**
 * Identify a file from its leading bytes.
 *
 * Returns null for anything unrecognised — including every executable format, which
 * is how `.exe` is actually rejected rather than by trusting its name.
 */
export function sniffMimeType(bytes: Uint8Array): AllowedMimeType | null {
  // %PDF-
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";

  // JPEG SOI + marker
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";

  // PNG signature
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";

  // RIFF....WEBP
  if (asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP") return "image/webp";

  // ISO-BMFF: size, "ftyp", brand
  if (asciiAt(bytes, 4, 4) === "ftyp" && HEIF_BRANDS.has(asciiAt(bytes, 8, 4))) {
    return "image/heic";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Filenames and object keys
// ---------------------------------------------------------------------------

/**
 * Make a user-supplied filename safe to echo back in a Content-Disposition header.
 *
 * Never used as an object key — see buildObjectKey.
 */
export function sanitiseFileName(fileName: string): string {
  const withoutPath = fileName.replace(/^.*[\\/]/, "");
  const cleaned = withoutPath
    // Strip control characters, quotes and anything that breaks a header.
    .replace(/[\u0000-\u001f\u007f"\\;\r\n]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length > 0 ? cleaned.slice(0, 200) : "document";
}

/**
 * The filename a browser will save the file as.
 *
 * Sanitising alone is not enough. `id".pdf"; attachment; filename="evil.exe` survives
 * quote-stripping as `id.pdf attachment filename=evil.exe` — safely inside one quoted
 * header value, so no injection, but a browser saving it produces a file ending in
 * `.exe`. Since the true type is already known from the magic bytes, the extension is
 * replaced rather than trusted.
 */
export function downloadFileName(fileName: string, mimeType: AllowedMimeType): string {
  const safe = sanitiseFileName(fileName);
  const withoutExtension = safe.replace(/\.[a-zA-Z0-9]{1,8}$/, "").trim();
  const base = withoutExtension.length > 0 ? withoutExtension : "document";
  return `${base}.${extensionFor(mimeType)}`;
}

/**
 * RFC 6266 Content-Disposition with an RFC 5987 encoded filename.
 *
 * The `filename*` parameter is what makes Arabic filenames survive the round trip —
 * a bare `filename="هوية.pdf"` is mangled or dropped by most browsers, and Arabic
 * document names are the norm rather than the exception here.
 */
export function contentDisposition(
  disposition: "inline" | "attachment",
  fileName: string,
  mimeType: AllowedMimeType,
): string {
  const name = downloadFileName(fileName, mimeType);
  const asciiFallback = name.replace(/[^ -~]/g, "_");
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Build the object key an upload is stored under.
 *
 * The user's filename is deliberately not part of the key. Using it invites path
 * traversal (`../../etc/passwd`), collisions between two customers who both upload
 * "passport.pdf", and leaks personal names into storage paths and logs. The original
 * filename is kept in the database column instead, where it belongs.
 */
export function buildObjectKey(
  ownerType: string,
  ownerId: string,
  mimeType: AllowedMimeType,
): string {
  const segment = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "unknown";
  return `${segment(ownerType).toLowerCase()}/${segment(ownerId)}/${randomUUID()}.${extensionFor(mimeType)}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface UploadCandidate {
  fileName: string;
  /** Client-declared type. Accepted as a hint only; never used for a decision. */
  declaredMimeType?: string | undefined;
  bytes: Uint8Array;
}

export interface UploadValidationOptions {
  maxBytes?: number;
}

export type UploadValidation =
  | { valid: true; mimeType: AllowedMimeType; fileName: string; sizeBytes: number }
  | { valid: false; errors: string[] };

export function validateUpload(
  candidate: UploadCandidate,
  options: UploadValidationOptions = {},
): UploadValidation {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const errors: string[] = [];
  const sizeBytes = candidate.bytes.byteLength;

  if (sizeBytes === 0) {
    errors.push("File is empty.");
  }
  if (sizeBytes > maxBytes) {
    const limitMb = Math.floor(maxBytes / (1024 * 1024));
    errors.push(`File is larger than the ${limitMb} MB limit.`);
  }

  const sniffed = sniffMimeType(candidate.bytes);
  if (sniffed === null) {
    errors.push(
      "Unsupported file type. Upload a PDF or an image (JPEG, PNG, WebP or HEIC).",
    );
  }

  if (errors.length > 0 || sniffed === null) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    mimeType: sniffed,
    fileName: sanitiseFileName(candidate.fileName),
    sizeBytes,
  };
}
