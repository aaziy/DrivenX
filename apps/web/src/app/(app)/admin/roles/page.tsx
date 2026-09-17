import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { prisma } from "@drivenx/db";

import { DataTable, type Column } from "@/components/data-table";
import { seededRoleDescriptionKey, seededRoleKey } from "@/i18n/labels";
import { requirePermission } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("roles");
  return { title: `${t("title")} · DrivenX` };
}

type RoleRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  _count: { permissions: number; users: number };
};

export default async function RolesPage() {
  const principal = await requirePermission("role.view");
  const canManage = principal.permissions.has("role.manage");

  const [t, roles] = await Promise.all([
    getTranslations("roles"),
    prisma.role.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        isSystem: true,
        _count: { select: { permissions: true, users: true } },
      },
    }),
  ]);

  const columns: Column<RoleRow>[] = [
    {
      key: "name",
      header: t("columns.role"),
      render: (role) => {
        const nameKey = seededRoleKey(role);
        const descriptionKey = seededRoleDescriptionKey(role);
        const description = descriptionKey
          ? t(`defaultDescriptions.${descriptionKey}`)
          : role.description;

        return (
          <>
            <div style={{ fontWeight: 560 }}>
              {nameKey ? t(`defaultNames.${nameKey}`) : role.name}
            </div>
            {description ? (
              <div className="muted" style={{ fontSize: 12.5, maxWidth: "58ch" }}>
                {description}
              </div>
            ) : null}
          </>
        );
      },
    },
    {
      key: "permissions",
      header: t("columns.permissions"),
      numeric: true,
      render: (role) => role._count.permissions,
    },
    {
      key: "users",
      header: t("columns.users"),
      numeric: true,
      render: (role) => role._count.users,
    },
    {
      key: "actions",
      header: "",
      render: (role) => (
        <Link href={`/admin/roles/${role.id}`} className="btn-link">
          {canManage ? t("edit") : t("view")}
        </Link>
      ),
    },
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("title")}</h1>
          <p className="page-subtitle">{t("subtitle")}</p>
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
