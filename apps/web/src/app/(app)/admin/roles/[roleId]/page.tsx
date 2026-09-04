import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@drivenx/db";

import { requirePermission } from "@/lib/auth";

import { PermissionEditor } from "./permission-editor";

export const metadata = { title: "Edit role · DrivenX" };

export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ roleId: string }>;
}) {
  const { roleId } = await params;
  const principal = await requirePermission("role.view");
  const canManage = principal.permissions.has("role.manage");

  const [role, permissions] = await Promise.all([
    prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: { select: { permissionId: true } } },
    }),
    prisma.permission.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] }),
  ]);

  if (!role) notFound();

  const grouped = new Map<string, typeof permissions>();
  for (const permission of permissions) {
    const bucket = grouped.get(permission.group) ?? [];
    bucket.push(permission);
    grouped.set(permission.group, bucket);
  }

  return (
    <>
      <header className="page-header">
        <div>
          <Link href="/admin/roles" className="btn-link">
            ← All roles
          </Link>
          <h1 style={{ marginTop: 6 }}>{role.name}</h1>
          {role.description ? <p className="page-subtitle">{role.description}</p> : null}
        </div>
      </header>

      <div className="page-body">
        <PermissionEditor
          roleId={role.id}
          groups={[...grouped.entries()].map(([group, items]) => ({
            group,
            items: items.map((permission) => ({
              id: permission.id,
              key: permission.key,
              description: permission.description ?? permission.key,
            })),
          }))}
          granted={role.permissions.map((entry) => entry.permissionId)}
          readOnly={!canManage}
        />
      </div>
    </>
  );
}
