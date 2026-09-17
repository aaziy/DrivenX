import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { prisma } from "@drivenx/db";

import { DataTable, type Column } from "@/components/data-table";
import { seededRoleKey } from "@/i18n/labels";
import { requirePermission } from "@/lib/auth";

import { CreateUserForm } from "./create-user-form";
import { ToggleActive } from "./toggle-active";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("users");
  return { title: `${t("title")} · DrivenX` };
}

type RoleSummary = { key: string; name: string; isSystem: boolean };

type UserRow = {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  roles: { role: RoleSummary }[];
};

export default async function UsersPage() {
  const principal = await requirePermission("user.view");
  const canManage = principal.permissions.has("user.manage");

  const [t, tc, tr, format, users, roles] = await Promise.all([
    getTranslations("users"),
    getTranslations("common"),
    getTranslations("roles"),
    getFormatter(),
    prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        fullName: true,
        email: true,
        isActive: true,
        lastLoginAt: true,
        roles: { select: { role: { select: { key: true, name: true, isSystem: true } } } },
      },
    }),
    prisma.role.findMany({
      orderBy: { name: "asc" },
      select: { id: true, key: true, name: true, isSystem: true },
    }),
  ]);

  // A seeded role is shown in the reader's language; one the client renamed is theirs.
  const roleLabel = (role: RoleSummary) => {
    const key = seededRoleKey(role);
    return key ? tr(`defaultNames.${key}`) : role.name;
  };

  const columns: Column<UserRow>[] = [
    {
      key: "name",
      header: t("columns.name"),
      render: (user) => (
        <>
          <div style={{ fontWeight: 560 }}>{user.fullName}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            <bdi>{user.email}</bdi>
          </div>
        </>
      ),
    },
    {
      key: "roles",
      header: t("columns.roles"),
      render: (user) =>
        user.roles.length === 0 ? (
          <span className="muted">{tc("none")}</span>
        ) : (
          <span className="row" style={{ flexWrap: "wrap", gap: 5 }}>
            {user.roles.map((assignment) => (
              <span key={assignment.role.key} className="badge">
                {roleLabel(assignment.role)}
              </span>
            ))}
          </span>
        ),
    },
    {
      key: "status",
      header: t("columns.status"),
      render: (user) => (
        <span className={user.isActive ? "badge badge-success" : "badge badge-danger"}>
          {user.isActive ? t("status.active") : t("status.deactivated")}
        </span>
      ),
    },
    {
      key: "lastLogin",
      header: t("columns.lastSignIn"),
      render: (user) =>
        user.lastLoginAt ? (
          <time dateTime={user.lastLoginAt.toISOString()}>
            {format.dateTime(user.lastLoginAt, { dateStyle: "short", timeStyle: "short" })}
          </time>
        ) : (
          <span className="muted">{t("lastSignInNever")}</span>
        ),
    },
  ];

  if (canManage) {
    columns.push({
      key: "actions",
      header: "",
      render: (user) =>
        user.id === principal.id ? (
          <span className="muted" style={{ fontSize: 12.5 }}>
            {tc("you")}
          </span>
        ) : (
          <ToggleActive userId={user.id} isActive={user.isActive} />
        ),
    });
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("title")}</h1>
          <p className="page-subtitle">{t("subtitle")}</p>
        </div>
      </header>

      <div className="page-body stack">
        {canManage ? (
          <div className="card">
            <div className="card-header">
              <h2>{t("addTitle")}</h2>
            </div>
            <div className="card-body">
              <CreateUserForm
                roles={roles.map((role) => ({ id: role.id, label: roleLabel(role) }))}
              />
            </div>
          </div>
        ) : null}

        <div className="card">
          <div className="card-header">
            <h2>{t("allTitle")}</h2>
            <span className="muted">{tc("total", { count: users.length })}</span>
          </div>
          <DataTable
            rows={users}
            columns={columns}
            rowKey={(user) => user.id}
            emptyTitle={t("emptyTitle")}
          />
        </div>
      </div>
    </>
  );
}
