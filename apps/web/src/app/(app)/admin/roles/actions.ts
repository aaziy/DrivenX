"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@drivenx/db";

import { asActor, requirePermission } from "@/lib/auth";

export interface RoleFormState {
  error?: string;
  success?: string;
}

/**
 * Replace a role's permission set (SOW §2 — configurable by the Super Admin).
 *
 * Written as a diff rather than delete-all-then-insert so the audit log records
 * exactly which permissions were granted and revoked. Wiping and re-inserting would
 * produce dozens of meaningless rows on every save and bury the one change that
 * mattered.
 */
export async function updateRolePermissions(
  roleId: string,
  _previous: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const principal = await requirePermission("role.manage");

  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: { permissions: true },
  });
  if (!role) return { error: "That role no longer exists." };

  const selected = new Set(formData.getAll("permission").map(String));
  const held = new Set(role.permissions.map((entry) => entry.permissionId));

  const validPermissions = await prisma.permission.findMany({
    where: { id: { in: [...selected] } },
    select: { id: true },
  });
  const validIds = new Set(validPermissions.map((permission) => permission.id));

  const toGrant = [...validIds].filter((id) => !held.has(id));
  const toRevoke = [...held].filter((id) => !validIds.has(id));

  if (toGrant.length === 0 && toRevoke.length === 0) {
    return { success: "No changes to save." };
  }

  await asActor(principal, async () => {
    if (toRevoke.length > 0) {
      await prisma.rolePermission.deleteMany({
        where: { roleId, permissionId: { in: toRevoke } },
      });
    }
    for (const permissionId of toGrant) {
      await prisma.rolePermission.create({ data: { roleId, permissionId } });
    }
  });

  revalidatePath("/admin/roles");
  revalidatePath(`/admin/roles/${roleId}`);

  const parts: string[] = [];
  if (toGrant.length > 0) parts.push(`${toGrant.length} granted`);
  if (toRevoke.length > 0) parts.push(`${toRevoke.length} revoked`);

  return {
    success: `Saved — ${parts.join(", ")}. Takes effect on each affected user's next request.`,
  };
}
