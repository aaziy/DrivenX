import { can, type PermissionKey } from "@drivenx/auth";

import { Nav, type NavGroup } from "@/components/nav";
import { requireUser } from "@/lib/auth";

import { logout } from "./actions";

/**
 * Authenticated shell.
 *
 * Guarding here covers every route in the group, so a new page cannot be added
 * without a login check — the failure mode of per-page guards is the page someone
 * forgets.
 *
 * Note this is navigation only. Hiding a link is a usability decision, not a security
 * one: each page independently calls `requirePermission`, because a hidden link is
 * still a reachable URL.
 */
const NAV_DEFINITION: Array<{
  label: string;
  items: Array<{ href: string; label: string; permission: PermissionKey }>;
}> = [
  {
    label: "Overview",
    items: [{ href: "/", label: "Dashboard", permission: "dashboard.view" }],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/users", label: "Users", permission: "user.view" },
      { href: "/admin/roles", label: "Roles & permissions", permission: "role.view" },
      { href: "/admin/audit", label: "Audit log", permission: "audit.view" },
    ],
  },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const principal = await requireUser();

  const groups: NavGroup[] = NAV_DEFINITION.map((group) => ({
    label: group.label,
    items: group.items
      .filter((item) => can(principal, item.permission))
      .map(({ href, label }) => ({ href, label })),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">DrivenX</span>
          <span className="brand-sub">Fleet</span>
        </div>

        <Nav groups={groups} />

        <div className="sidebar-footer">
          <div className="session-user">
            <div className="session-name">{principal.fullName}</div>
            <div className="session-role">{principal.email}</div>
          </div>
          <form action={logout}>
            <button type="submit" className="btn-link">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}
