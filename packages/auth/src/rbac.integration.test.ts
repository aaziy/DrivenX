/**
 * P0-07 integration tests.
 *
 * The exit criterion for this task is specific: a Super Admin edits a role's
 * permissions and the change takes effect *immediately*, without the affected user
 * logging out and back in. That requirement is the reason permissions are resolved per
 * request instead of being embedded in the session token, so it gets a test that would
 * fail loudly if anyone "optimised" that decision away later.
 */

import { prisma } from "@drivenx/db";
import { beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "./password";
import { can } from "./rbac";
import { loadPrincipal } from "./session";

async function seedPermissions(keys: string[]): Promise<Map<string, string>> {
  await prisma.permission.createMany({
    data: keys.map((key) => ({ key, group: "Test", description: key })),
  });
  const rows = await prisma.permission.findMany({ select: { id: true, key: true } });
  return new Map(rows.map((row) => [row.key, row.id]));
}

async function createRoleWith(key: string, permissionIds: string[]): Promise<string> {
  const role = await prisma.role.create({ data: { key, name: key } });
  await prisma.rolePermission.createMany({
    data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
  });
  return role.id;
}

async function createUserWithRoles(roleIds: string[]): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: "operator@drivenx.ae",
      fullName: "Operator",
      passwordHash: await hashPassword("DrivenX2026Fleet"),
      roles: { create: roleIds.map((roleId) => ({ roleId })) },
    },
  });
  return user.id;
}

describe("loadPrincipal [P0-07]", () => {
  let permissionIds: Map<string, string>;
  let roleId: string;
  let userId: string;

  beforeEach(async () => {
    permissionIds = await seedPermissions(["contract.view", "contract.activate", "payment.record"]);
    roleId = await createRoleWith("operator", [
      permissionIds.get("contract.view")!,
      permissionIds.get("contract.activate")!,
    ]);
    userId = await createUserWithRoles([roleId]);
  });

  it("resolves the permissions granted through the user's role", async () => {
    const principal = await loadPrincipal(userId);

    expect(principal).not.toBeNull();
    expect(can(principal, "contract.view")).toBe(true);
    expect(can(principal, "contract.activate")).toBe(true);
    expect(can(principal, "payment.record")).toBe(false);
  });

  // -- The P0-07 exit criterion --

  it("reflects a REVOKED permission on the very next request, with no re-login", async () => {
    const before = await loadPrincipal(userId);
    expect(can(before, "contract.activate")).toBe(true);

    await prisma.rolePermission.delete({
      where: {
        roleId_permissionId: { roleId, permissionId: permissionIds.get("contract.activate")! },
      },
    });

    const after = await loadPrincipal(userId);
    expect(can(after, "contract.activate")).toBe(false);
    expect(can(after, "contract.view")).toBe(true);
  });

  it("reflects a GRANTED permission on the very next request, with no re-login", async () => {
    expect(can(await loadPrincipal(userId), "payment.record")).toBe(false);

    await prisma.rolePermission.create({
      data: { roleId, permissionId: permissionIds.get("payment.record")! },
    });

    expect(can(await loadPrincipal(userId), "payment.record")).toBe(true);
  });

  it("reflects a role being removed from the user immediately", async () => {
    await prisma.userRole.delete({ where: { userId_roleId: { userId, roleId } } });

    const principal = await loadPrincipal(userId);
    expect(principal?.permissions.size).toBe(0);
    expect(can(principal, "contract.view")).toBe(false);
  });

  it("unions permissions across multiple roles", async () => {
    const financeRole = await createRoleWith("finance", [permissionIds.get("payment.record")!]);
    await prisma.userRole.create({ data: { userId, roleId: financeRole } });

    const principal = await loadPrincipal(userId);
    expect(can(principal, "contract.view")).toBe(true);
    expect(can(principal, "payment.record")).toBe(true);
    expect(principal?.roleKeys).toHaveLength(2);
  });

  it("keeps a permission held via a second role after the first is revoked", async () => {
    const financeRole = await createRoleWith("finance", [permissionIds.get("contract.view")!]);
    await prisma.userRole.create({ data: { userId, roleId: financeRole } });

    await prisma.rolePermission.delete({
      where: {
        roleId_permissionId: { roleId, permissionId: permissionIds.get("contract.view")! },
      },
    });

    // Still granted through finance — revoking one role must not over-revoke.
    expect(can(await loadPrincipal(userId), "contract.view")).toBe(true);
  });

  it("returns null for a deactivated user", async () => {
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    expect(await loadPrincipal(userId)).toBeNull();
  });

  it("returns null for a soft-deleted user", async () => {
    await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
    expect(await loadPrincipal(userId)).toBeNull();
  });

  it("returns null for an unknown id", async () => {
    expect(await loadPrincipal("does_not_exist")).toBeNull();
  });

  it("cascades role deletion without orphaning grants", async () => {
    await prisma.role.delete({ where: { id: roleId } });

    expect(await prisma.rolePermission.count({ where: { roleId } })).toBe(0);
    expect(await prisma.userRole.count({ where: { roleId } })).toBe(0);

    const principal = await loadPrincipal(userId);
    expect(principal?.permissions.size).toBe(0);
  });
});
