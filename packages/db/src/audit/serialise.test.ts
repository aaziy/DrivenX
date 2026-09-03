import { describe, expect, it } from "vitest";

import { diffRecords, isSensitiveField, REDACTED, sanitiseRecord, toJsonValue } from "./serialise";

describe("isSensitiveField", () => {
  it.each([
    "passwordHash",
    "password_hash",
    "password",
    "newPassword",
    "AUTH_SECRET",
    "secretAccessKey",
    "apiKey",
    "api_key",
    "accessToken",
    "credential",
  ])("flags %s", (field) => {
    expect(isSensitiveField(field)).toBe(true);
  });

  it.each(["email", "fullName", "monthlyRentalFils", "plateNumber", "status", "id"])(
    "does not flag %s",
    (field) => {
      expect(isSensitiveField(field)).toBe(false);
    },
  );
});

describe("toJsonValue", () => {
  it("stringifies BigInt", () => {
    // Money is BigInt fils. JSON.stringify throws on BigInt outright, so without this
    // the audit extension breaks the moment contracts land in 1D.
    expect(toJsonValue(340050n)).toBe("340050");
    expect(() => JSON.stringify({ v: toJsonValue(340050n) })).not.toThrow();
  });

  it("converts Date to ISO", () => {
    expect(toJsonValue(new Date("2026-09-04T10:00:00Z"))).toBe("2026-09-04T10:00:00.000Z");
  });

  it("handles null and undefined", () => {
    expect(toJsonValue(null)).toBeNull();
    expect(toJsonValue(undefined)).toBeNull();
  });

  it("recurses into arrays and objects, redacting as it goes", () => {
    expect(toJsonValue([{ passwordHash: "$argon2id$x", amount: 100n }])).toEqual([
      { passwordHash: REDACTED, amount: "100" },
    ]);
  });

  it("summarises binary rather than embedding it", () => {
    expect(toJsonValue(Buffer.from("hello"))).toBe("[binary 5 bytes]");
  });
});

describe("sanitiseRecord", () => {
  it("redacts secrets and serialises the rest", () => {
    expect(
      sanitiseRecord({
        id: "u1",
        email: "a@drivenx.ae",
        passwordHash: "$argon2id$v=19$m=19456",
        balanceFils: 340050n,
        createdAt: new Date("2026-09-04T10:00:00Z"),
      }),
    ).toEqual({
      id: "u1",
      email: "a@drivenx.ae",
      passwordHash: REDACTED,
      balanceFils: "340050",
      createdAt: "2026-09-04T10:00:00.000Z",
    });
  });

  it("never lets an argon2 hash through", () => {
    const result = sanitiseRecord({ passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$abc$def" });
    expect(JSON.stringify(result)).not.toContain("argon2");
  });
});

describe("diffRecords", () => {
  it("returns only the changed fields", () => {
    const result = diffRecords(
      { id: "u1", email: "old@drivenx.ae", fullName: "Same", isActive: true },
      { id: "u1", email: "new@drivenx.ae", fullName: "Same", isActive: true },
    );

    expect(result).toEqual({
      before: { email: "old@drivenx.ae" },
      after: { email: "new@drivenx.ae" },
    });
  });

  it("returns null when nothing changed, so no-op updates write no audit row", () => {
    expect(diffRecords({ id: "u1", email: "a@b.ae" }, { id: "u1", email: "a@b.ae" })).toBeNull();
  });

  it("ignores updatedAt, which changes on every write and tells a reader nothing", () => {
    expect(
      diffRecords(
        { id: "u1", updatedAt: new Date("2026-09-04T10:00:00Z") },
        { id: "u1", updatedAt: new Date("2026-09-04T11:00:00Z") },
      ),
    ).toBeNull();
  });

  it("records that a secret changed without recording either value", () => {
    const result = diffRecords({ passwordHash: "old-hash" }, { passwordHash: "new-hash" });

    expect(result).toEqual({
      before: { passwordHash: REDACTED },
      after: { passwordHash: REDACTED },
    });
    expect(JSON.stringify(result)).not.toContain("hash");
  });

  it("detects BigInt changes", () => {
    expect(diffRecords({ amountFils: 340000n }, { amountFils: 340050n })).toEqual({
      before: { amountFils: "340000" },
      after: { amountFils: "340050" },
    });
  });

  it("treats an added or removed field as a change", () => {
    expect(diffRecords({ a: 1 }, { a: 1, b: 2 })).toEqual({
      before: { b: null },
      after: { b: 2 },
    });
  });

  it("distinguishes null from a missing value only when it matters", () => {
    expect(diffRecords({ note: null }, {})).toBeNull();
  });

  it("detects a Date change", () => {
    expect(
      diffRecords(
        { expiryDate: new Date("2026-01-01T00:00:00Z") },
        { expiryDate: new Date("2027-01-01T00:00:00Z") },
      ),
    ).toEqual({
      before: { expiryDate: "2026-01-01T00:00:00.000Z" },
      after: { expiryDate: "2027-01-01T00:00:00.000Z" },
    });
  });
});
