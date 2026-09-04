import Link from "next/link";

import { prisma } from "@drivenx/db";

import { DataTable, type Column } from "@/components/data-table";
import { requirePermission } from "@/lib/auth";

export const metadata = { title: "Roles · DrivenX" };

type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  _count: { permissions: number; users: number };
};

export default async function RolesPage() {
  const principal = await requirePermission("role.view");
  const canManage = principal.permissions.has("role.manage");

  const roles = await prisma.role.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      isSystem: true,
      _count: { select: { permissions: true, users: true } },
    },
  });

  const columns: Column<RoleRow>[] = [
    {
      key: "name",
      header: "Role",
      render: (role) => (
        <>
          <div style={{ fontWeight: 560 }}>{role.name}</div>
          {role.description ? (
            <div className="muted" style={{ fontSize: 12.5, maxWidth: "58ch" }}>
              {role.description}
            </div>
          ) : null}
        </>
      ),
    },
    {
      key: "permissions",
      header: "Permissions",
      numeric: true,
      render: (role) => role._count.permissions,
    },
    { key: "users", header: "Users", numeric: true, render: (role) => role._count.users },
    {
      key: "actions",
      header: "",
      render: (role) => (
        <Link href={`/admin/roles/${role.id}`} className="btn-link">
          {canManage ? "Edit permissions" : "View permissions"}
        </Link>
      ),
    },
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Roles &amp; permissions</h1>
          <p className="page-subtitle">
            Permissions are stored as data, not code. Changes take effect on each affected
            user&rsquo;s next request &mdash; nobody needs to sign out and back in.
          </p>
        </div>
      </header>

      <div className="page-body">
        <div className="card">
          <DataTable rows={roles} columns={columns} rowKey={(role) => role.id} />
        </div>
      </div>
    </>
  );
}
