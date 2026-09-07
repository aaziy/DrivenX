/**
 * P0-12 exit criterion: "Seed runs deterministically twice with identical output."
 */

import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_ROLES, PERMISSIONS, resolveRolePermissions } from "@drivenx/auth/permissions";

import { prisma, withoutAudit } from "../index";
import { seedGoldenDataset } from "../../prisma/seed-golden";
import { GOLDEN_TODAY, GOLDEN_USERS, goldenDate } from "./dataset";

/** Minimal base seed — the golden dataset needs roles to attach users to. */
async function seedRoles() {
  await withoutAudit(async () => {
    await prisma.permission.createMany({
      data: PERMISSIONS.map((permission) => ({
        key: permission.key,
        group: permission.group,
        description: permission.description,
      })),
    });
    const permissionIds = new Map(
      (await prisma.permission.findMany({ select: { id: true, key: true } })).map((p) => [
        p.key,
        p.id,
      ]),
    );

    for (const definition of DEFAULT_ROLES) {
      const role = await prisma.role.create({
        data: { key: definition.key, name: definition.name, isSystem: true },
      });
      await prisma.rolePermission.createMany({
        data: resolveRolePermissions(definition)
          .map((key) => permissionIds.get(key))
          .filter((id): id is string => id !== undefined)
          .map((permissionId) => ({ roleId: role.id, permissionId })),
      });
    }
  });
}

/** Everything the dataset controls, in a comparable shape. */
async function snapshot() {
  const users = await prisma.user.findMany({
    where: { id: { startsWith: "gold_" } },
    orderBy: { id: "asc" },
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      isActive: true,
      failedLogins: true,
      lockedUntil: true,
      roles: { select: { role: { select: { key: true } } }, orderBy: { roleId: "asc" } },
    },
  });
  return JSON.stringify(users);
}

describe("golden dataset [P0-12]", () => {
  beforeEach(async () => {
    await seedRoles();
  });

  it("produces identical state when run twice", async () => {
    await seedGoldenDataset();
    const first = await snapshot();

    await seedGoldenDataset();
    const second = await snapshot();

    expect(second).toBe(first);
  });

  it("creates one account per persona with stable ids", async () => {
    await seedGoldenDataset();

    const users = await prisma.user.findMany({ where: { id: { startsWith: "gold_" } } });
    expect(users).toHaveLength(GOLDEN_USERS.length);
    expect(users.map((user) => user.id).sort()).toEqual(
      GOLDEN_USERS.map((user) => user.id).sort(),
    );
  });

  it("assigns each persona the role the dataset declares", async () => {
    await seedGoldenDataset();

    for (const expected of GOLDEN_USERS.filter((user) => user.roleKey)) {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: expected.id },
        include: { roles: { include: { role: true } } },
      });
      expect(user.roles.map((assignment) => assignment.role.key)).toEqual([expected.roleKey]);
    }
  });

  it("leaves the no-roles persona with no roles", async () => {
    await seedGoldenDataset();

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "noroles@drivenx.ae" },
      include: { roles: true },
    });
    expect(user.roles).toHaveLength(0);
  });

  it("keeps the deactivated persona deactivated", async () => {
    await seedGoldenDataset();

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "deactivated@drivenx.ae" },
    });
    expect(user.isActive).toBe(false);
  });

  it("clears a lockout left behind by an earlier test run", async () => {
    await seedGoldenDataset();
    await prisma.user.update({
      where: { id: GOLDEN_USERS[0]!.id },
      data: { failedLogins: 5, lockedUntil: new Date("2030-01-01") },
    });

    await seedGoldenDataset();

    // Otherwise one lockout test poisons every subsequent QA session.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: GOLDEN_USERS[0]!.id } });
    expect(user.failedLogins).toBe(0);
    expect(user.lockedUntil).toBeNull();
  });

  it("converges after the data is tampered with", async () => {
    await seedGoldenDataset();
    await prisma.user.update({
      where: { id: GOLDEN_USERS[1]!.id },
      data: { fullName: "Tampered", isActive: false },
    });

    await seedGoldenDataset();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: GOLDEN_USERS[1]!.id } });
    expect(user.fullName).toBe(GOLDEN_USERS[1]!.fullName);
    expect(user.isActive).toBe(true);
  });

  it("writes no audit rows", async () => {
    // Eight users of system noise on a fresh database would bury the genuine activity
    // the log exists to surface.
    await seedGoldenDataset();
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("refuses to run without a base seed", async () => {
    await prisma.rolePermission.deleteMany({});
    await prisma.userRole.deleteMany({});
    await prisma.role.deleteMany({});

    await expect(seedGoldenDataset()).rejects.toThrow(/base seed/i);
  });
});

describe("golden clock", () => {
  it("is anchored to a fixed date, not the wall clock", () => {
    expect(GOLDEN_TODAY.toISOString()).toBe("2026-06-15T08:00:00.000Z");
  });

  it("computes relative dates from the anchor", () => {
    expect(goldenDate(30).toISOString().slice(0, 10)).toBe("2026-07-15");
    expect(goldenDate(-1).toISOString().slice(0, 10)).toBe("2026-06-14");
  });

  it("crosses a month boundary correctly", () => {
    expect(goldenDate(16).toISOString().slice(0, 10)).toBe("2026-07-01");
  });
});
