import { describe, expect, it } from "vitest";

import {
  isSensitiveField,
  REDACTED,
  redactRecord,
  redactValue,
  serialiseError,
} from "./redaction";

describe("isSensitiveField", () => {
  it.each([
    "passwordHash",
    "password_hash",
    "PASSWORD-HASH",
    "newPassword",
    "AUTH_SECRET",
    "secretAccessKey",
    "apiKey",
    "api_key",
    "accessToken",
    "credential",
    "Authorization",
    "Cookie",
    "sessionId",
    "privateKey",
  ])("flags %s", (field) => {
    expect(isSensitiveField(field)).toBe(true);
  });

  it.each(["email", "fullName", "monthlyRentalFils", "plateNumber", "status", "id", "vin"])(
    "does not flag %s",
    (field) => {
      expect(isSensitiveField(field)).toBe(false);
    },
  );
});

describe("redactValue", () => {
  it("stringifies BigInt so amounts can be logged at all", () => {
    expect(redactValue(340050n)).toBe("340050");
    expect(() => JSON.stringify(redactValue({ amountFils: 340050n }))).not.toThrow();
  });

  it("converts Date to ISO", () => {
    expect(redactValue(new Date("2026-09-11T10:00:00Z"))).toBe("2026-09-11T10:00:00.000Z");
  });

  it("redacts nested secrets", () => {
    expect(redactValue({ user: { email: "a@b.ae", passwordHash: "$argon2id$x" } })).toEqual({
      user: { email: "a@b.ae", passwordHash: REDACTED },
    });
  });

  it("redacts secrets inside arrays", () => {
    expect(redactValue([{ token: "abc" }])).toEqual([{ token: REDACTED }]);
  });

  it("survives a circular reference", () => {
    // ORM results and request objects are routinely cyclic; without a guard one log
    // call takes the process down.
    const node: Record<string, unknown> = { name: "root" };
    node["self"] = node;
    expect(() => JSON.stringify(redactValue(node))).not.toThrow();
    expect(redactValue(node)).toEqual({ name: "root", self: "[circular]" });
  });

  it("summarises binary rather than embedding it", () => {
    expect(redactValue(Buffer.from("hello"))).toBe("[binary 5 bytes]");
  });

  it("handles functions, null and undefined", () => {
    expect(redactValue(() => 1)).toBe("[function]");
    expect(redactValue(null)).toBeNull();
    expect(redactValue(undefined)).toBeNull();
  });

  it("never lets an argon2 hash through", () => {
    const output = JSON.stringify(redactRecord({ passwordHash: "$argon2id$v=19$m=19456$abc" }));
    expect(output).not.toContain("argon2");
  });
});

describe("serialiseError", () => {
  it("captures name, message and stack", () => {
    const result = serialiseError(new TypeError("bad input"));
    expect(result.name).toBe("TypeError");
    expect(result.message).toBe("bad input");
    expect(result.stack).toContain("TypeError");
  });

  it("does not vanish under JSON.stringify", () => {
    // JSON.stringify(new Error("x")) is "{}" — an incident becomes an empty log line.
    expect(JSON.stringify(new Error("boom"))).toBe("{}");
    expect(JSON.stringify(serialiseError(new Error("boom")))).toContain("boom");
  });

  it("includes a cause", () => {
    const result = serialiseError(new Error("outer", { cause: new Error("inner") }));
    expect(JSON.stringify(result.cause)).toContain("inner");
  });

  it("redacts secrets carried on the cause", () => {
    const result = serialiseError(new Error("outer", { cause: { apiKey: "sk-live-123" } }));
    expect(JSON.stringify(result.cause)).not.toContain("sk-live-123");
  });

  it("handles non-Error throws", () => {
    expect(serialiseError("just a string")).toEqual({
      name: "NonError",
      message: "just a string",
    });
  });

  it("redacts an error nested inside a logged object", () => {
    const output = redactValue({ err: new Error("failed"), password: "hunter2" });
    expect(JSON.stringify(output)).toContain("failed");
    expect(JSON.stringify(output)).not.toContain("hunter2");
  });
});
