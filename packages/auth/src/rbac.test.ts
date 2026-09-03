import { describe, expect, it } from "vitest";

import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLES,
  PERMISSIONS,
  resolveRolePermissions,
} from "./permissions";
import {
  buildPrincipal,
  can,
  canAll,
  canAny,
  NotAuthenticatedError,
  PermissionDeniedError,
  requirePermission,
  type Principal,
} from "./rbac";

function principal(permissions: string[], overrides: Partial<Principal> = {}): Principal {
  return {
    id: "user_1",
    email: "test@drivenx.ae",
    fullName: "Test User",
    isActive: true,
    permissions: new Set(permissions),
    roleKeys: ["test"],
    ...overrides,
  };
}

describe("can", () => {
  it("grants a held permission", () => {
    expect(can(principal(["contract.view"]), "contract.view")).toBe(true);
  });

  it("denies a permission not held", () => {
    expect(can(principal(["contract.view"]), "contract.activate")).toBe(false);
  });

  it("denies everything to an unauthenticated principal", () => {
    expect(can(null, "dashboard.view")).toBe(false);
  });

  it("denies everything to a deactivated user, even with permissions attached", () => {
    // Deactivation must be immediate and total — a deactivated user still holding
    // role rows should not be able to act.
    const deactivated = principal(ALL_PERMISSION_KEYS as string[], { isActive: false });
    expect(can(deactivated, "payment.record")).toBe(false);
    expect(canAny(deactivated, "payment.record", "dashboard.view")).toBe(false);
  });
});

describe("canAny / canAll", () => {
  const user = principal(["contract.view", "payment.view"]);

  it("canAny is true when at least one is held", () => {
    expect(canAny(user, "contract.view", "payment.waive")).toBe(true);
    expect(canAny(user, "payment.waive", "user.manage")).toBe(false);
  });

  it("canAll requires every permission", () => {
    expect(canAll(user, "contract.view", "payment.view")).toBe(true);
    expect(canAll(user, "contract.view", "payment.waive")).toBe(false);
  });

  it("canAll on an empty list is vacuously true", () => {
    expect(canAll(user)).toBe(true);
  });

  it("canAny on an empty list is false", () => {
    expect(canAny(user)).toBe(false);
  });
});

describe("requirePermission", () => {
  it("passes silently when held", () => {
    expect(() => requirePermission(principal(["contract.view"]), "contract.view")).not.toThrow();
  });

  it("throws PermissionDeniedError carrying the user and permission", () => {
    try {
      requirePermission(principal(["contract.view"]), "payment.waive");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionDeniedError);
      expect((error as PermissionDeniedError).permission).toBe("payment.waive");
      expect((error as PermissionDeniedError).userId).toBe("user_1");
    }
  });

  it("throws NotAuthenticatedError for a null principal", () => {
    expect(() => requirePermission(null, "dashboard.view")).toThrow(NotAuthenticatedError);
  });

  it("distinguishes 'not logged in' from 'not allowed'", () => {
    // These must stay separate: one is a 401 and a redirect to login, the other is a
    // 403 and an audit-worthy event.
    expect(() => requirePermission(null, "dashboard.view")).toThrow(NotAuthenticatedError);
    expect(() => requirePermission(principal([]), "dashboard.view")).toThrow(PermissionDeniedError);
  });
});

describe("buildPrincipal", () => {
  it("unions permissions across multiple roles", () => {
    const result = buildPrincipal({
      id: "u1",
      email: "a@b.ae",
      fullName: "Multi Role",
      isActive: true,
      roles: [
        { key: "sales", permissions: ["lead.view", "deal.calculate"] },
        { key: "finance", permissions: ["payment.view", "deal.calculate"] },
      ],
    });

    expect(result.permissions).toEqual(new Set(["lead.view", "deal.calculate", "payment.view"]));
    expect(result.roleKeys).toEqual(["sales", "finance"]);
  });

  it("produces an empty set for a user with no roles", () => {
    const result = buildPrincipal({
      id: "u1",
      email: "a@b.ae",
      fullName: "No Roles",
      isActive: true,
      roles: [],
    });
    expect(result.permissions.size).toBe(0);
    expect(can(result, "dashboard.view")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Catalogue integrity — a typo here silently removes access from a whole role
// ---------------------------------------------------------------------------

describe("permission catalogue", () => {
  it("has no duplicate permission keys", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has no duplicate role keys", () => {
    const keys = DEFAULT_ROLES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every role references only permissions that exist", () => {
    const valid = new Set<string>(ALL_PERMISSION_KEYS);
    const dangling: string[] = [];

    for (const role of DEFAULT_ROLES) {
      for (const permission of resolveRolePermissions(role)) {
        if (!valid.has(permission)) dangling.push(`${role.key} -> ${permission}`);
      }
    }

    expect(dangling).toEqual([]);
  });

  it("uses a consistent 'resource.action' key format", () => {
    const malformed = PERMISSIONS.filter((p) => !/^[a-z][a-z_]*\.[a-z][a-z_]*$/.test(p.key));
    expect(malformed).toEqual([]);
  });

  it("grants Super Admin every permission, including future phases", () => {
    const superAdmin = DEFAULT_ROLES.find((r) => r.key === "super_admin");
    expect(superAdmin?.permissions).toBe("*");
    expect(resolveRolePermissions(superAdmin!)).toHaveLength(PERMISSIONS.length);
  });

  it("seeds the five SOW §2 roles", () => {
    expect(DEFAULT_ROLES.map((r) => r.key)).toEqual([
      "super_admin",
      "admin",
      "sales",
      "finance",
      "operations",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Role boundaries — these encode SOW §2 and must fail loudly if someone widens a role
// ---------------------------------------------------------------------------

describe("default role boundaries [SOW §2]", () => {
  function roleFor(key: string): Principal {
    const role = DEFAULT_ROLES.find((r) => r.key === key)!;
    return principal([...resolveRolePermissions(role)], { roleKeys: [key] });
  }

  it("only Super Admin can manage users and roles", () => {
    for (const key of ["admin", "sales", "finance", "operations"]) {
      expect(can(roleFor(key), "user.manage")).toBe(false);
      expect(can(roleFor(key), "role.manage")).toBe(false);
    }
    expect(can(roleFor("super_admin"), "user.manage")).toBe(true);
    expect(can(roleFor("super_admin"), "role.manage")).toBe(true);
  });

  it("Sales Staff sees only their own leads", () => {
    const sales = roleFor("sales");
    expect(can(sales, "lead.view")).toBe(true);
    expect(can(sales, "lead.view_all")).toBe(false);
  });

  it("Sales Staff cannot record or waive payments", () => {
    const sales = roleFor("sales");
    expect(can(sales, "payment.record")).toBe(false);
    expect(can(sales, "payment.waive")).toBe(false);
  });

  it("Sales Staff cannot activate a contract", () => {
    // Drafting is sales; activating generates the payment schedule and posts to the
    // ledger, so it stays with Admin and Finance.
    expect(can(roleFor("sales"), "contract.create")).toBe(true);
    expect(can(roleFor("sales"), "contract.activate")).toBe(false);
  });

  it("Operations cannot touch payments or financial reports", () => {
    const operations = roleFor("operations");
    expect(can(operations, "payment.record")).toBe(false);
    expect(can(operations, "report.financial")).toBe(false);
    expect(can(operations, "vehicle.transition")).toBe(true);
  });

  it("Finance owns payments and financial reporting", () => {
    const finance = roleFor("finance");
    expect(canAll(finance, "payment.record", "payment.waive", "report.financial")).toBe(true);
  });

  it("Finance cannot alter the fleet", () => {
    const finance = roleFor("finance");
    expect(can(finance, "vehicle.view")).toBe(true);
    expect(can(finance, "vehicle.update")).toBe(false);
    expect(can(finance, "vehicle.transition")).toBe(false);
  });

  it("every non-super-admin role can view the dashboard", () => {
    for (const role of DEFAULT_ROLES) {
      expect(can(roleFor(role.key), "dashboard.view")).toBe(true);
    }
  });
});
