import { describe, expect, it } from "vitest";

import {
  GENERIC_ERROR_MESSAGE,
  isUserFacingError,
  Logger,
  newErrorReference,
  UserFacingError,
  type LogEntry,
} from "./index";

function capture(options: Partial<ConstructorParameters<typeof Logger>[0]> = {}) {
  const entries: LogEntry[] = [];
  const log = new Logger({
    level: "debug",
    now: () => new Date("2026-09-11T10:00:00.000Z"),
    write: (entry) => entries.push(entry),
    ...options,
  });
  return { log, entries };
}

describe("Logger", () => {
  it("emits time, level and message", () => {
    const { log, entries } = capture();
    log.info("contract activated");

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      time: "2026-09-11T10:00:00.000Z",
      level: "info",
      msg: "contract activated",
    });
  });

  it("includes structured fields", () => {
    const { log, entries } = capture();
    log.info("payment recorded", { contractId: "c1", amountFils: 340050n });

    expect(entries[0]).toMatchObject({ contractId: "c1", amountFils: "340050" });
  });

  it("serialises BigInt so a money field cannot break logging", () => {
    const { log, entries } = capture();
    log.info("amount", { fils: 340050n });
    expect(() => JSON.stringify(entries[0])).not.toThrow();
  });

  it("redacts secrets anywhere in the fields", () => {
    const { log, entries } = capture();
    log.info("user loaded", { user: { email: "a@b.ae", passwordHash: "$argon2id$x" } });

    expect(JSON.stringify(entries[0])).not.toContain("argon2");
    expect(JSON.stringify(entries[0])).toContain("a@b.ae");
  });

  it("respects the level threshold", () => {
    const { log, entries } = capture({ level: "warn" });
    log.debug("ignored");
    log.info("ignored");
    log.warn("kept");
    log.error("kept");

    expect(entries.map((entry) => entry.level)).toEqual(["warn", "error"]);
  });

  it("serialises a thrown error rather than flattening it to {}", () => {
    const { log, entries } = capture();
    log.error("activation failed", new TypeError("bad contract"));

    const err = entries[0]?.["err"] as { name: string; message: string };
    expect(err.name).toBe("TypeError");
    expect(err.message).toBe("bad contract");
  });

  it("handles a non-Error throw", () => {
    const { log, entries } = capture();
    log.error("weird", "just a string");
    expect(entries[0]?.["err"]).toMatchObject({ name: "NonError", message: "just a string" });
  });

  it("logs an error with no error object", () => {
    const { log, entries } = capture();
    log.error("no cause attached");
    expect(entries[0]).not.toHaveProperty("err");
  });

  describe("child", () => {
    it("attaches base fields to every entry", () => {
      const { log, entries } = capture();
      const requestLog = log.child({ requestId: "req_123" });

      requestLog.info("first");
      requestLog.warn("second");

      expect(entries.every((entry) => entry["requestId"] === "req_123")).toBe(true);
    });

    it("lets a call override a base field", () => {
      const { log, entries } = capture();
      log.child({ userId: "u1" }).info("acting", { userId: "u2" });
      expect(entries[0]?.["userId"]).toBe("u2");
    });

    it("does not mutate the parent", () => {
      const { log, entries } = capture();
      log.child({ requestId: "req_1" }).info("child");
      log.info("parent");

      expect(entries[1]).not.toHaveProperty("requestId");
    });

    it("nests", () => {
      const { log, entries } = capture();
      log.child({ requestId: "r1" }).child({ userId: "u1" }).info("both");
      expect(entries[0]).toMatchObject({ requestId: "r1", userId: "u1" });
    });
  });

  it("cannot have its reserved fields overwritten", () => {
    const { log, entries } = capture();
    log.info("real message", { msg: "spoofed", level: "debug" });

    expect(entries[0]?.msg).toBe("real message");
    expect(entries[0]?.level).toBe("info");
  });

  it("survives a circular field value", () => {
    const { log, entries } = capture();
    const node: Record<string, unknown> = { name: "x" };
    node["self"] = node;

    expect(() => log.info("cyclic", { node })).not.toThrow();
    expect(() => JSON.stringify(entries[0])).not.toThrow();
  });
});

describe("UserFacingError", () => {
  it("is distinguishable from an ordinary error", () => {
    expect(isUserFacingError(new UserFacingError("Email already in use."))).toBe(true);
    expect(isUserFacingError(new Error("relation \"users\" violates constraint"))).toBe(false);
    expect(isUserFacingError("nope")).toBe(false);
  });
});

describe("newErrorReference", () => {
  it("is formatted for reading aloud", () => {
    expect(newErrorReference()).toMatch(/^[0-9A-HJ-NP-TV-Z]{4}-[0-9A-HJ-NP-TV-Z]{4}$/);
  });

  it("omits characters that are ambiguous when spoken or transcribed", () => {
    const sample = Array.from({ length: 300 }, () => newErrorReference()).join("");
    // I/L/O/U are excluded so a reference read over the phone survives the trip.
    expect(sample).not.toMatch(/[ILOU]/);
  });

  it("is effectively unique", () => {
    const references = new Set(Array.from({ length: 2000 }, () => newErrorReference()));
    expect(references.size).toBeGreaterThan(1990);
  });

  it("exposes a generic message that leaks nothing", () => {
    expect(GENERIC_ERROR_MESSAGE).not.toMatch(/sql|prisma|constraint|stack/i);
  });
});
