import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { prisma } from "@drivenx/db";

import {
  permissionGroupMessageKey,
  permissionMessageKey,
  seededRoleDescriptionKey,
  seededRoleKey,
} from "@/i18n/labels";
import { requirePermission } from "@/lib/auth";

import { PermissionEditor } from "./permission-editor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("roles");
  return { title: `${t("editTitle")} · DrivenX` };
}

export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ roleId: string }>;
}) {
  const { roleId } = await params;
  const principal = await requirePermission("role.view");
  const canManage = principal.permissions.has("role.manage");

  const [t, tr, role, permissions] = await Promise.all([
    getTranslations(),
    getTranslations("roles"),
    prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: { select: { permissionId: true } } },
    }),
    prisma.permission.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] }),
  ]);

  if (!role) notFound();

  // The seeded catalogue is translated; anything a later phase adds without a message
  // still shows its English description rather than a blank row.
  const translate = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);

  const grouped = new Map<string, typeof permissions>();
  for (const permission of permissions) {
    const bucket = grouped.get(permission.group) ?? [];
    bucket.push(permission);
    grouped.set(permission.group, bucket);
  }

  const nameKey = seededRoleKey(role);
  const descriptionKey = seededRoleDescriptionKey(role);
  const description = descriptionKey
    ? tr(`defaultDescriptions.${descriptionKey}`)
    : role.description;

  return (
    <>
      <header className="page-header">
        <div>
          <Link href="/admin/roles" className="btn-link">
            {tr("backToAll")}
          </Link>
          <h1 style={{ marginTop: 6 }}>{nameKey ? tr(`defaultNames.${nameKey}`) : role.name}</h1>
          {description ? <p className="page-subtitle">{description}</p> : null}
        </div>
      </header>

      <div className="page-body">
        <PermissionEditor
          roleId={role.id}
          groups={[...grouped.entries()].map(([group, items]) => ({
            group: translate(permissionGroupMessageKey(group), group),
            items: items.map((permission) => ({
              id: permission.id,
              key: permission.key,
              description: translate(
                permissionMessageKey(permission.key),
                permission.description ?? permission.key,
              ),
            })),
          }))}
          granted={role.permissions.map((entry) => entry.permissionId)}
          readOnly={!canManage}
        />
      </div>
    </>
  );
}
