/**
 * Seed: permission catalogue, default roles, and the initial Super Admin (P0-08).
 *
 * Idempotent — safe to re-run on every deploy. New permissions introduced by later
 * phases are added; existing role customisations made by the client are preserved.
 *
 * The one thing this script must never do is reset a role's permissions back to the
 * defaults. SOW §2 makes roles client-configurable, so once seeded, `role_permissions`
 * belongs to the client. Re-running the seed after they have tailored a role must not
 * silently undo their work.
 */

import { PERMISSIONS, DEFAULT_ROLES, resolveRolePermissions } from "@drivenx/auth/permissions";
import { hashPassword } from "@drivenx/auth/password";
import { DOCUMENT_CATEGORIES } from "@drivenx/core";

import { prisma, withoutAudit } from "../src/index";

async function seedPermissions(): Promise<Map<string, string>> {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { group: permission.group, description: permission.description },
      create: {
        key: permission.key,
        group: permission.group,
        description: permission.description,
      },
    });
  }

  const rows = await prisma.permission.findMany({ select: { id: true, key: true } });
  console.log(`  permissions: ${rows.length}`);
  return new Map(rows.map((row) => [row.key, row.id]));
}

async function seedRoles(permissionIds: Map<string, string>): Promise<void> {
  for (const definition of DEFAULT_ROLES) {
    const existing = await prisma.role.findUnique({
      where: { key: definition.key },
      include: { permissions: true },
    });

    const role = await prisma.role.upsert({
      where: { key: definition.key },
      update: { name: definition.name, description: definition.description },
      create: {
        key: definition.key,
        name: definition.name,
        description: definition.description,
        isSystem: true,
      },
    });

    const desired = resolveRolePermissions(definition);

    if (!existing) {
      // First seed — grant the full default set.
      await prisma.rolePermission.createMany({
        data: desired
          .map((key) => permissionIds.get(key))
          .filter((id): id is string => id !== undefined)
          .map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
      console.log(`  role ${definition.key}: created with ${desired.length} permissions`);
      continue;
    }

    // Role already exists and may have been customised by the client. Only top up
    // Super Admin, which is defined as "everything" and so must pick up permissions
    // added by later phases. Every other role is left exactly as configured.
    if (definition.permissions === "*") {
      const held = new Set(existing.permissions.map((rp) => rp.permissionId));
      const missing = desired
        .map((key) => permissionIds.get(key))
        .filter((id): id is string => id !== undefined && !held.has(id));

      if (missing.length > 0) {
        await prisma.rolePermission.createMany({
          data: missing.map((permissionId) => ({ roleId: role.id, permissionId })),
          skipDuplicates: true,
        });
      }
      console.log(`  role ${definition.key}: topped up with ${missing.length} new permissions`);
    } else {
      console.log(`  role ${definition.key}: exists, left as configured`);
    }
  }
}

/**
 * Document categories (§6), created if missing and never overwritten.
 *
 * §17 makes these the client's to edit, so a re-run must not undo a label they
 * reworded or a reminder schedule they tuned — the same rule the roles follow.
 * Exported so the integration test can exercise it without running the whole seed.
 */
export async function seedDocumentCategories(): Promise<void> {
  let created = 0;

  for (const category of DOCUMENT_CATEGORIES) {
    const existing = await prisma.documentCategory.findUnique({ where: { key: category.key } });
    if (existing) continue;

    await prisma.documentCategory.create({
      data: {
        key: category.key,
        label: category.label,
        appliesTo: [...category.appliesTo],
        requiresExpiry: category.requiresExpiry,
        defaultReminderOffsets: [...category.defaultReminderOffsets],
        isSystem: true,
      },
    });
    created += 1;
  }

  console.log(`  document categories: ${DOCUMENT_CATEGORIES.length} defined, ${created} created`);
}

async function seedSuperAdmin(): Promise<void> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@drivenx.ae").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe2026Now";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`  super admin: ${email} already exists, password unchanged`);
    return;
  }

  const superAdminRole = await prisma.role.findUniqueOrThrow({ where: { key: "super_admin" } });

  await prisma.user.create({
    data: {
      email,
      fullName: "DrivenX Super Admin",
      passwordHash: await hashPassword(password),
      roles: { create: { roleId: superAdminRole.id } },
    },
  });

  console.log(`  super admin: created ${email}`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log(`  ⚠  default password "${password}" — change it before any deployment`);
  }
}

async function main(): Promise<void> {
  console.log("Seeding DrivenX...");

  // Suppressed: seeding writes ~200 rows on a fresh database, and letting those into
  // the audit log would bury the genuine user activity SOW §17 exists to surface under
  // system noise on day one.
  await withoutAudit(async () => {
    const permissionIds = await seedPermissions();
    await seedRoles(permissionIds);
    await seedDocumentCategories();
    await seedSuperAdmin();
  });

  console.log("Seed complete.");
}

// Only when invoked directly. Without this guard, importing any function from this
// file — as the integration test does — would run the entire seed as a side effect and
// disconnect the client underneath the caller.
if (process.argv[1]?.endsWith("prisma/seed.ts")) {
  main()
    .catch((error: unknown) => {
      console.error("Seed failed:", error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
