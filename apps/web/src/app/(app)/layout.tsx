import { getTranslations } from "next-intl/server";

import { can, type PermissionKey } from "@drivenx/auth";

import { LanguageSwitcher } from "@/components/language-switcher";
import { Nav, type NavGroup } from "@/components/nav";
import { currentLocale } from "@/i18n/locale";
import { requireUser } from "@/lib/auth";

import { logout } from "./actions";

/**
 * Authenticated shell.
 *
 * Guarding here covers every route in the group, so a new page cannot be added without
 * a login check — the failure mode of per-page guards is the page someone forgets.
 *
 * Note this is navigation only. Hiding a link is a usability decision, not a security
 * one: each page independently calls `requirePermission`, because a hidden link is
 * still a reachable URL.
 */
const NAV_DEFINITION: Array<{
  labelKey: string;
  items: Array<{ href: string; labelKey: string; permission: PermissionKey }>;
}> = [
  {
    labelKey: "overview",
    items: [{ href: "/", labelKey: "dashboard", permission: "dashboard.view" }],
  },
  {
    labelKey: "administration",
    items: [
      { href: "/admin/users", labelKey: "users", permission: "user.view" },
      { href: "/admin/roles", labelKey: "roles", permission: "role.view" },
      { href: "/admin/audit", labelKey: "audit", permission: "audit.view" },
    ],
  },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const principal = await requireUser();
  const [t, tc, locale] = await Promise.all([
    getTranslations("nav"),
    getTranslations("common"),
    currentLocale(),
  ]);

  const groups: NavGroup[] = NAV_DEFINITION.map((group) => ({
    label: t(group.labelKey),
    items: group.items
      .filter((item) => can(principal, item.permission))
      .map(({ href, labelKey }) => ({ href, label: t(labelKey) })),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">DrivenX</span>
          <span className="brand-sub">{tc("brandSub")}</span>
        </div>

        <Nav groups={groups} ariaLabel={t("mainLabel")} />

        <div className="sidebar-footer">
          <LanguageSwitcher current={locale} />

          <div className="session-user">
            <div className="session-name">{principal.fullName}</div>
            {/* An email is always left-to-right, whichever way the page is facing. */}
            <div className="session-role">
              <bdi>{principal.email}</bdi>
            </div>
          </div>

          <form action={logout}>
            <button type="submit" className="btn-link">
              {tc("signOut")}
            </button>
          </form>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}
