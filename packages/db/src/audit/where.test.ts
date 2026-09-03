import { describe, expect, it } from "vitest";

import { flattenUniqueWhere } from "./extension";

describe("flattenUniqueWhere", () => {
  it("unwraps a compound unique key into flat fields", () => {
    expect(
      flattenUniqueWhere({ roleId_permissionId: { roleId: "r1", permissionId: "p1" } }),
    ).toEqual({ roleId: "r1", permissionId: "p1" });
  });

  it("unwraps regardless of key order inside the wrapper", () => {
    expect(flattenUniqueWhere({ userId_roleId: { roleId: "r1", userId: "u1" } })).toEqual({
      userId: "u1",
      roleId: "r1",
    });
  });

  it("leaves a simple unique where untouched", () => {
    expect(flattenUniqueWhere({ id: "u1" })).toEqual({ id: "u1" });
    expect(flattenUniqueWhere({ email: "a@drivenx.ae" })).toEqual({ email: "a@drivenx.ae" });
  });

  it("leaves filter operators untouched", () => {
    expect(flattenUniqueWhere({ id: { in: ["a", "b"] } })).toEqual({ id: { in: ["a", "b"] } });
    expect(flattenUniqueWhere({ deletedAt: null })).toEqual({ deletedAt: null });
  });

  it("does not unwrap a relation filter that merely contains an underscore", () => {
    // A field named with an underscore whose inner keys do not reconstruct the name is
    // a genuine nested filter, not a compound key wrapper.
    const relation = { some_relation: { status: "ACTIVE" } };
    expect(flattenUniqueWhere(relation)).toEqual(relation);
  });

  it("does not unwrap when inner keys do not match the compound name", () => {
    const filter = { roleId_permissionId: { roleId: "r1", somethingElse: "x" } };
    expect(flattenUniqueWhere(filter)).toEqual(filter);
  });

  it("passes through null, undefined and non-objects", () => {
    expect(flattenUniqueWhere(null)).toBeNull();
    expect(flattenUniqueWhere(undefined)).toBeUndefined();
    expect(flattenUniqueWhere("x")).toBe("x");
  });

  it("preserves sibling conditions alongside a compound key", () => {
    expect(
      flattenUniqueWhere({
        roleId_permissionId: { roleId: "r1", permissionId: "p1" },
        grantedAt: { lt: "2026-01-01" },
      }),
    ).toEqual({ roleId: "r1", permissionId: "p1", grantedAt: { lt: "2026-01-01" } });
  });
});
