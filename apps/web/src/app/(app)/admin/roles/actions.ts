"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { prisma } from "@drivenx/db";

import { asActor, requirePermission } from "@/lib/auth";
import { requestLogger, toUserMessage } from "@/lib/log";

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
  const t = await getTranslations("roles");

  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: { permissions: true },
  });
  if (!role) return { error: t("errors.roleGone") };

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
    return { success: t("noChanges") };
  }

  try {
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
  } catch (error) {
    return { error: await toUserMessage("updateRolePermissions", error) };
  }

  const log = await requestLogger();
  log.info("role permissions changed", {
    roleKey: role.key,
    granted: toGrant.length,
    revoked: toRevoke.length,
    actorId: principal.id,
  });

  revalidatePath("/admin/roles");
  revalidatePath(`/admin/roles/${roleId}`);

  const parts: string[] = [];
  if (toGrant.length > 0) parts.push(t("granted", { count: toGrant.length }));
  if (toRevoke.length > 0) parts.push(t("revoked", { count: toRevoke.length }));

  return { success: t("savedSummary", { summary: parts.join(t("listSeparator")) }) };
}
