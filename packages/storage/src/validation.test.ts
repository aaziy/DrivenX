import { describe, expect, it } from "vitest";

import {
  buildObjectKey,
  contentDisposition,
  DEFAULT_MAX_UPLOAD_BYTES,
  downloadFileName,
  isAllowedMimeType,
  sanitiseFileName,
  sniffMimeType,
  validateUpload,
} from "./validation";

// Real magic-byte prefixes, padded so the buffers are non-trivially sized.
const bytes = (...prefix: number[]) => new Uint8Array([...prefix, ...new Array(64).fill(0)]);
const ascii = (text: string, offset = 0) => {
  const buffer = new Uint8Array(64);
  for (let i = 0; i < text.length; i += 1) buffer[offset + i] = text.charCodeAt(i);
  return buffer;
};

const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const EXE = bytes(0x4d, 0x5a, 0x90, 0x00); // MZ — Windows PE
const ELF = bytes(0x7f, 0x45, 0x4c, 0x46); // Linux executable
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04);

function webp(): Uint8Array {
  const buffer = ascii("RIFF");
  const tag = "WEBP";
  for (let i = 0; i < tag.length; i += 1) buffer[8 + i] = tag.charCodeAt(i);
  return buffer;
}

function heic(brand = "heic"): Uint8Array {
  const buffer = new Uint8Array(64);
  const header = `????ftyp${brand}`;
  for (let i = 4; i < header.length; i += 1) buffer[i] = header.charCodeAt(i);
  return buffer;
}

describe("sniffMimeType", () => {
  it.each([
    [PDF, "application/pdf"],
    [JPEG, "image/jpeg"],
    [PNG, "image/png"],
    [webp(), "image/webp"],
    [heic("heic"), "image/heic"],
    [heic("mif1"), "image/heic"],
    [heic("heix"), "image/heic"],
  ])("identifies %#", (input, expected) => {
    expect(sniffMimeType(input)).toBe(expected);
  });

  it.each([
    [EXE, "Windows executable"],
    [ELF, "Linux executable"],
    [ZIP, "zip archive"],
    [new Uint8Array(0), "empty buffer"],
    [ascii("<html><script>alert(1)</script>"), "HTML"],
    [ascii("#!/bin/sh\nrm -rf /"), "shell script"],
  ])("returns null for %#: %s", (input) => {
    expect(sniffMimeType(input)).toBeNull();
  });

  it("does not accept a truncated signature", () => {
    expect(sniffMimeType(new Uint8Array([0x25, 0x50]))).toBeNull();
    expect(sniffMimeType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  it("rejects an ISO-BMFF container whose brand is not a HEIF image", () => {
    // mp42 is a video container: right box structure, wrong content.
    expect(sniffMimeType(heic("mp42"))).toBeNull();
  });
});

describe("validateUpload", () => {
  it("accepts a PDF and reports the sniffed type", () => {
    const result = validateUpload({ fileName: "emirates-id.pdf", bytes: PDF });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.mimeType).toBe("application/pdf");
      expect(result.sizeBytes).toBe(PDF.byteLength);
    }
  });

  // -- The point of the whole module --

  it("rejects an executable renamed to look like a document", () => {
    // Extension and declared type both say PDF; the bytes say Windows executable.
    // Anything trusting the name or the header accepts this.
    const result = validateUpload({
      fileName: "passport.pdf",
      declaredMimeType: "application/pdf",
      bytes: EXE,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(" ")).toContain("Unsupported file type");
  });

  it("ignores the declared type entirely and trusts the bytes", () => {
    // Declared as an executable, actually a PNG — accepted, because the declared
    // value is a hint from the client and carries no authority either way.
    const result = validateUpload({
      fileName: "scan.png",
      declaredMimeType: "application/x-msdownload",
      bytes: PNG,
    });

    expect(result.valid).toBe(true);
    if (result.valid) expect(result.mimeType).toBe("image/png");
  });

  it("rejects a file over the size cap", () => {
    const oversized = new Uint8Array(DEFAULT_MAX_UPLOAD_BYTES + 1);
    oversized.set(PDF.subarray(0, 8));

    const result = validateUpload({ fileName: "big.pdf", bytes: oversized });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(" ")).toContain("10 MB limit");
  });

  it("accepts a file exactly on the cap", () => {
    const exact = new Uint8Array(1024);
    exact.set(PDF.subarray(0, 8));
    expect(validateUpload({ fileName: "ok.pdf", bytes: exact }, { maxBytes: 1024 }).valid).toBe(
      true,
    );
  });

  it("rejects an empty file", () => {
    const result = validateUpload({ fileName: "empty.pdf", bytes: new Uint8Array(0) });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(" ")).toContain("empty");
  });

  it("reports size and type problems together", () => {
    const result = validateUpload(
      { fileName: "bad.exe", bytes: new Uint8Array([0x4d, 0x5a, ...new Array(2048).fill(0)]) },
      { maxBytes: 512 },
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors).toHaveLength(2);
  });
});

describe("sanitiseFileName", () => {
  it.each([
    ["../../etc/passwd", "passwd"],
    ["C:\\Users\\admin\\id.pdf", "id.pdf"],
    ['bad"quote.pdf', "badquote.pdf"],
    ["with\r\nnewline.pdf", "withnewline.pdf"],
    ["  spaced  out.pdf  ", "spaced out.pdf"],
    ["", "document"],
    ["   ", "document"],
  ])("sanitises %j to %j", (input, expected) => {
    expect(sanitiseFileName(input)).toBe(expected);
  });

  it("strips a header-injection attempt", () => {
    // Would otherwise break out of the Content-Disposition header.
    expect(sanitiseFileName('x.pdf"; attachment; filename="evil.exe')).not.toContain('"');
  });

  it("truncates absurdly long names", () => {
    expect(sanitiseFileName(`${"a".repeat(500)}.pdf`).length).toBeLessThanOrEqual(200);
  });

  it("keeps ordinary Arabic and accented names intact", () => {
    expect(sanitiseFileName("هوية.pdf")).toBe("هوية.pdf");
    expect(sanitiseFileName("José-licence.pdf")).toBe("José-licence.pdf");
  });
});

describe("downloadFileName", () => {
  it("forces the extension to match the sniffed content type", () => {
    // The attack sanitising alone does not stop: quotes are gone, but the browser
    // would still save a file ending in .exe.
    expect(downloadFileName('id".pdf"; attachment; filename="evil.exe', "application/pdf")).toBe(
      "id.pdf attachment filename=evil.pdf",
    );
  });

  it.each([
    ["emirates-id.pdf", "application/pdf", "emirates-id.pdf"],
    ["scan.PNG", "image/png", "scan.png"],
    ["photo.jpeg", "image/jpeg", "photo.jpg"],
    ["mismatched.pdf", "image/png", "mismatched.png"],
    ["no-extension", "application/pdf", "no-extension.pdf"],
    ["", "application/pdf", "document.pdf"],
  ])("%j as %s becomes %j", (input, mime, expected) => {
    expect(downloadFileName(input, mime as "application/pdf")).toBe(expected);
  });

  it("keeps Arabic names", () => {
    expect(downloadFileName("هوية.pdf", "application/pdf")).toBe("هوية.pdf");
  });
});

describe("contentDisposition", () => {
  it("emits both an ASCII fallback and an RFC 5987 encoded name", () => {
    const header = contentDisposition("inline", "هوية.pdf", "application/pdf");
    expect(header).toMatch(/^inline; filename="[^"]*"; filename\*=UTF-8''/);
    // Arabic survives via filename*; the fallback is ASCII-safe.
    expect(header).toContain(encodeURIComponent("هوية.pdf"));
  });

  it("cannot be broken out of by a crafted filename", () => {
    const header = contentDisposition(
      "inline",
      'x".pdf"; attachment; filename="evil.exe',
      "application/pdf",
    );
    expect(header.match(/"/g)).toHaveLength(2); // exactly one quoted value
    expect(header).not.toContain(".exe");
  });

  it("supports attachment disposition", () => {
    expect(contentDisposition("attachment", "x.pdf", "application/pdf")).toMatch(/^attachment;/);
  });
});

describe("buildObjectKey", () => {
  it("namespaces by owner and never reuses the user's filename", () => {
    const key = buildObjectKey("CUSTOMER", "cust_123", "application/pdf");
    expect(key).toMatch(/^customer\/cust_123\/[0-9a-f-]{36}\.pdf$/);
  });

  it("cannot be made to traverse out of its prefix", () => {
    const key = buildObjectKey("../../etc", "../root", "image/png");
    expect(key).not.toContain("..");
    expect(key.split("/")).toHaveLength(3);
  });

  it("produces a distinct key every time", () => {
    const a = buildObjectKey("CUSTOMER", "c1", "application/pdf");
    const b = buildObjectKey("CUSTOMER", "c1", "application/pdf");
    expect(a).not.toBe(b);
  });
});

describe("isAllowedMimeType", () => {
  it("accepts the allowlist and nothing else", () => {
    expect(isAllowedMimeType("application/pdf")).toBe(true);
    expect(isAllowedMimeType("image/heic")).toBe(true);
    expect(isAllowedMimeType("application/x-msdownload")).toBe(false);
    expect(isAllowedMimeType("text/html")).toBe(false);
    expect(isAllowedMimeType("image/svg+xml")).toBe(false); // SVG can carry script
  });
});
