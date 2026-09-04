/**
 * P0-09 integration tests.
 *
 * Exit criterion from the plan: "every write produces exactly one audit row with the
 * correct diff". Both halves matter — a duplicate row is as much a defect as a missing
 * one when the log is used to answer "who changed this?".
 */

import { beforeEach, describe, expect, it } from "vitest";

import { prisma, withAuditContext, withoutAudit } from "../index";
import { REDACTED } from "./serialise";

const PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA";

async function makeUser(email = "audited@drivenx.ae") {
  return prisma.user.create({
    data: { email, fullName: "Audited User", passwordHash: PASSWORD_HASH },
  });
}

/** Audit rows for one entity, excluding the CREATE that set it up. */
async function auditRowsFor(entityType: string, entityId: string) {
  return prisma.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "asc" },
  });
}

describe("audit extension [P0-09]", () => {
  it("writes exactly one CREATE row with the full record", async () => {
    const user = await makeUser();

    const rows = await auditRowsFor("User", user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("CREATE");
    expect(rows[0]?.before).toBeNull();
    expect(rows[0]?.after).toMatchObject({ email: "audited@drivenx.ae" });
  });

  it("writes exactly one UPDATE row containing only the changed fields", async () => {
    const user = await makeUser();
    await prisma.user.update({ where: { id: user.id }, data: { fullName: "Renamed" } });

    const rows = await auditRowsFor("User", user.id);
    expect(rows).toHaveLength(2);

    const update = rows[1]!;
    expect(update.action).toBe("UPDATE");
    expect(update.before).toEqual({ fullName: "Audited User" });
    expect(update.after).toEqual({ fullName: "Renamed" });
  });

  it("writes no row for a no-op update", async () => {
    const user = await makeUser();
    await prisma.user.update({ where: { id: user.id }, data: { fullName: "Audited User" } });

    expect(await auditRowsFor("User", user.id)).toHaveLength(1); // just the CREATE
  });

  it("writes exactly one DELETE row holding the final state", async () => {
    const user = await makeUser();
    await prisma.user.delete({ where: { id: user.id } });

    const rows = await auditRowsFor("User", user.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.action).toBe("DELETE");
    expect(rows[1]?.after).toBeNull();
    expect(rows[1]?.before).toMatchObject({ email: "audited@drivenx.ae" });
  });

  // -- The requirement that makes this table safe to expose --

  it("never records a password hash, on create or on change", async () => {
    const user = await makeUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$bmV3$bmV3aGFzaA" },
    });

    const rows = await auditRowsFor("User", user.id);
    const serialised = JSON.stringify(rows);

    expect(serialised).not.toContain("argon2");
    expect(serialised).not.toContain("aGFzaA");
    expect(rows[0]?.after).toMatchObject({ passwordHash: REDACTED });
    // The change is still recorded — just not its values.
    expect(rows[1]?.before).toEqual({ passwordHash: REDACTED });
    expect(rows[1]?.after).toEqual({ passwordHash: REDACTED });
  });

  it("does not audit the audit log itself", async () => {
    await makeUser();
    expect(await prisma.auditLog.count({ where: { entityType: "AuditLog" } })).toBe(0);
  });

  it("audits composite-key join rows, which is where permission changes live", async () => {
    const permission = await prisma.permission.create({
      data: { key: "contract.activate", group: "Contracts", description: "x" },
    });
    const role = await prisma.role.create({ data: { key: "ops", name: "Ops" } });

    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: permission.id },
    });

    const rows = await prisma.auditLog.findMany({ where: { entityType: "RolePermission" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("CREATE");
    // No `id` column exists, so the composite key identifies the row.
    expect(rows[0]?.entityId).toContain(role.id);
    expect(rows[0]?.entityId).toContain(permission.id);
  });

  it("captures prior state when a permission grant is revoked", async () => {
    // The archetypal SOW §17 question: who removed this person's access, and what did
    // they have before? Requires the compound-key `where` to be readable by findMany.
    const permission = await prisma.permission.create({
      data: { key: "payment.waive", group: "Payments", description: "x" },
    });
    const role = await prisma.role.create({ data: { key: "finance", name: "Finance" } });
    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: permission.id },
    });

    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    });

    const deleteRow = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "RolePermission", action: "DELETE" },
    });
    expect(deleteRow.before).toMatchObject({ roleId: role.id, permissionId: permission.id });
    expect(deleteRow.after).toBeNull();
  });

  it("records one row per affected row on updateMany", async () => {
    const a = await makeUser("a@drivenx.ae");
    const b = await makeUser("b@drivenx.ae");

    await prisma.user.updateMany({
      where: { id: { in: [a.id, b.id] } },
      data: { isActive: false },
    });

    const updates = await prisma.auditLog.findMany({
      where: { entityType: "User", action: "UPDATE" },
    });
    expect(updates).toHaveLength(2);
    expect(updates.every((row) => JSON.stringify(row.after) === '{"isActive":false}')).toBe(true);
  });

  it("records one row per affected row on deleteMany", async () => {
    await makeUser("a@drivenx.ae");
    await makeUser("b@drivenx.ae");

    await prisma.user.deleteMany({});

    const deletes = await prisma.auditLog.findMany({
      where: { entityType: "User", action: "DELETE" },
    });
    expect(deletes).toHaveLength(2);
  });

  it("treats upsert as CREATE then UPDATE", async () => {
    const where = { key: "ops" };

    await prisma.role.upsert({ where, create: { key: "ops", name: "Ops" }, update: {} });
    await prisma.role.upsert({ where, create: { key: "ops", name: "Ops" }, update: { name: "Operations" } });

    const rows = await prisma.auditLog.findMany({
      where: { entityType: "Role" },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((row) => row.action)).toEqual(["CREATE", "UPDATE"]);
    expect(rows[1]?.after).toEqual({ name: "Operations" });
  });
});

describe("audit attribution", () => {
  it("attributes mutations to the actor in scope", async () => {
    const actor = await makeUser("actor@drivenx.ae");

    await withAuditContext(
      { actorId: actor.id, ipAddress: "10.0.0.5", requestId: "req_123" },
      async () => {
        await prisma.role.create({ data: { key: "ops", name: "Ops" } });
      },
    );

    const row = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "Role" } });
    expect(row.actorId).toBe(actor.id);
    expect(row.ipAddress).toBe("10.0.0.5");
    expect(row.requestId).toBe("req_123");
  });

  it("records a null actor for system-originated changes", async () => {
    await prisma.role.create({ data: { key: "ops", name: "Ops" } });

    const row = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "Role" } });
    expect(row.actorId).toBeNull();
  });

  it("keeps attribution across awaits inside the context", async () => {
    const actor = await makeUser("actor@drivenx.ae");

    await withAuditContext({ actorId: actor.id }, async () => {
      await prisma.role.create({ data: { key: "a", name: "A" } });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await prisma.role.create({ data: { key: "b", name: "B" } });
    });

    const rows = await prisma.auditLog.findMany({ where: { entityType: "Role" } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.actorId === actor.id)).toBe(true);
  });

  it("does not leak attribution outside the context", async () => {
    const actor = await makeUser("actor@drivenx.ae");

    await withAuditContext({ actorId: actor.id }, async () => {
      await prisma.role.create({ data: { key: "inside", name: "Inside" } });
    });
    await prisma.role.create({ data: { key: "outside", name: "Outside" } });

    const inside = await prisma.auditLog.findFirstOrThrow({ where: { entityId: { not: "" }, action: "CREATE", entityType: "Role", after: { path: ["key"], equals: "inside" } } });
    const outside = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "Role", after: { path: ["key"], equals: "outside" } } });

    expect(inside.actorId).toBe(actor.id);
    expect(outside.actorId).toBeNull();
  });
});

describe("withoutAudit", () => {
  beforeEach(async () => {
    await prisma.auditLog.deleteMany({});
  });

  it("suppresses audit writes for seeds and data migrations", async () => {
    await withoutAudit(async () => {
      await prisma.role.create({ data: { key: "seeded", name: "Seeded" } });
    });

    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("resumes auditing after the suppressed block", async () => {
    await withoutAudit(async () => {
      await prisma.role.create({ data: { key: "seeded", name: "Seeded" } });
    });
    await prisma.role.create({ data: { key: "normal", name: "Normal" } });

    expect(await prisma.auditLog.count()).toBe(1);
  });
});
