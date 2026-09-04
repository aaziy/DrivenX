import { describe, expect, it } from "vitest";

import {
  createSessionToken,
  DEFAULT_SESSION_TTL_SECONDS,
  sessionCookieOptions,
  verifySessionToken,
} from "./session-token";

const SECRET = "test-secret-at-least-32-bytes-long!!";
const OTHER_SECRET = "a-completely-different-secret-value!!";
const NOW = new Date("2026-09-05T09:00:00Z");

describe("session tokens", () => {
  it("round-trips a user id", () => {
    const token = createSessionToken("user_abc123", SECRET, { now: NOW });
    expect(verifySessionToken(token, SECRET, NOW)).toBe("user_abc123");
  });

  it("carries no data beyond the user id", () => {
    // Anything else in the token is data that goes stale the moment it is issued.
    const token = createSessionToken("user_abc123", SECRET, { now: NOW });
    expect(token.split(".")).toHaveLength(3);
    expect(Buffer.from(token.split(".")[0]!, "base64url").toString()).toBe("user_abc123");
  });

  it("rejects a token signed with a different secret", () => {
    const token = createSessionToken("user_abc123", OTHER_SECRET, { now: NOW });
    expect(verifySessionToken(token, SECRET, NOW)).toBeNull();
  });

  it("rejects a tampered user id", () => {
    const token = createSessionToken("user_abc123", SECRET, { now: NOW });
    const [, expiry, sig] = token.split(".");
    const forged = `${Buffer.from("user_admin").toString("base64url")}.${expiry}.${sig}`;

    expect(verifySessionToken(forged, SECRET, NOW)).toBeNull();
  });

  it("rejects an extended expiry", () => {
    // Pushing the expiry out invalidates the signature over the payload.
    const token = createSessionToken("user_abc123", SECRET, { now: NOW });
    const [id, , sig] = token.split(".");
    const forged = `${id}.${9999999999}.${sig}`;

    expect(verifySessionToken(forged, SECRET, NOW)).toBeNull();
  });

  it("expires", () => {
    const token = createSessionToken("user_abc123", SECRET, { ttlSeconds: 60, now: NOW });

    expect(verifySessionToken(token, SECRET, new Date(NOW.getTime() + 59_000))).toBe("user_abc123");
    expect(verifySessionToken(token, SECRET, new Date(NOW.getTime() + 61_000))).toBeNull();
  });

  it("defaults to an eight-hour working day", () => {
    const token = createSessionToken("user_abc123", SECRET, { now: NOW });
    const expiry = Number(token.split(".")[1]);
    expect(expiry - Math.floor(NOW.getTime() / 1000)).toBe(DEFAULT_SESSION_TTL_SECONDS);
  });

  it.each([
    ["", "empty"],
    ["garbage", "not a token"],
    ["a.b", "too few parts"],
    ["a.b.c.d", "too many parts"],
    ["...", "empty parts"],
    [".1780000000.sig", "no user id"],
  ])("rejects %j (%s)", (token) => {
    expect(verifySessionToken(token, SECRET, NOW)).toBeNull();
  });

  it("rejects null and undefined without throwing", () => {
    expect(verifySessionToken(null, SECRET, NOW)).toBeNull();
    expect(verifySessionToken(undefined, SECRET, NOW)).toBeNull();
  });

  it("rejects everything when no secret is configured", () => {
    // A misconfigured deployment must fail closed, never open.
    const token = createSessionToken("user_abc123", SECRET, { now: NOW });
    expect(verifySessionToken(token, "", NOW)).toBeNull();
  });

  it("refuses to issue a token without a secret", () => {
    expect(() => createSessionToken("user_abc123", "")).toThrow(/secret/i);
  });

  it("produces a different signature for each user", () => {
    const a = createSessionToken("user_a", SECRET, { now: NOW });
    const b = createSessionToken("user_b", SECRET, { now: NOW });
    expect(a.split(".")[2]).not.toBe(b.split(".")[2]);
  });
});

describe("sessionCookieOptions", () => {
  it("is httpOnly and sameSite lax", () => {
    const options = sessionCookieOptions({ secure: false });
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  it("is secure in production", () => {
    expect(sessionCookieOptions({ secure: true }).secure).toBe(true);
  });
});
