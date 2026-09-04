import { prisma } from "@drivenx/db";

import { DataTable, type Column } from "@/components/data-table";
import { requirePermission } from "@/lib/auth";

import { CreateUserForm } from "./create-user-form";
import { ToggleActive } from "./toggle-active";

export const metadata = { title: "Users · DrivenX" };

type UserRow = {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  roles: { role: { name: string } }[];
};

export default async function UsersPage() {
  const principal = await requirePermission("user.view");
  const canManage = principal.permissions.has("user.manage");

  const [users, roles] = await Promise.all([
    prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        fullName: true,
        email: true,
        isActive: true,
        lastLoginAt: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    }),
    prisma.role.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const columns: Column<UserRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (user) => (
        <>
          <div style={{ fontWeight: 560 }}>{user.fullName}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {user.email}
          </div>
        </>
      ),
    },
    {
      key: "roles",
      header: "Roles",
      render: (user) =>
        user.roles.length === 0 ? (
          <span className="muted">None</span>
        ) : (
          <span className="row" style={{ flexWrap: "wrap", gap: 5 }}>
            {user.roles.map((assignment) => (
              <span key={assignment.role.name} className="badge">
                {assignment.role.name}
              </span>
            ))}
          </span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (user) => (
        <span className={user.isActive ? "badge badge-success" : "badge badge-danger"}>
          {user.isActive ? "Active" : "Deactivated"}
        </span>
      ),
    },
    {
      key: "lastLogin",
      header: "Last sign-in",
      render: (user) =>
        user.lastLoginAt ? (
          <time dateTime={user.lastLoginAt.toISOString()}>
            {user.lastLoginAt.toLocaleString("en-GB", { timeZone: "Asia/Dubai" })}
          </time>
        ) : (
          <span className="muted">Never</span>
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
            You
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
          <h1>Users</h1>
          <p className="page-subtitle">
            Staff accounts and their roles. Deactivating an account takes effect on that
            person&rsquo;s next request.
          </p>
        </div>
      </header>

      <div className="page-body stack">
        {canManage ? (
          <div className="card">
            <div className="card-header">
              <h2>Add a user</h2>
            </div>
            <div className="card-body">
              <CreateUserForm roles={roles} />
            </div>
          </div>
        ) : null}

        <div className="card">
          <div className="card-header">
            <h2>All users</h2>
            <span className="muted">{users.length} total</span>
          </div>
          <DataTable
            rows={users}
            columns={columns}
            rowKey={(user) => user.id}
            emptyTitle="No users yet"
          />
        </div>
      </div>
    </>
  );
}
