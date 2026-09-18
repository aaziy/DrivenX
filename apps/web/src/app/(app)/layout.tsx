import { getTranslations } from "next-intl/server";

import { can, type PermissionKey } from "@drivenx/auth";

import { LanguageSwitcher } from "@/components/language-switcher";
import { Nav, type NavGroup, type NavItem } from "@/components/nav";
import { unreadCount, visibleTypes } from "@/lib/notifications";
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
    labelKey: "relationships",
    items: [
      { href: "/customers", labelKey: "customers", permission: "customer.view" },
      { href: "/suppliers", labelKey: "suppliers", permission: "supplier.view" },
    ],
  },
  {
    labelKey: "fleet",
    items: [{ href: "/vehicles", labelKey: "vehicles", permission: "vehicle.view" }],
  },
  {
    labelKey: "administration",
    items: [
      { href: "/admin/users", labelKey: "users", permission: "user.view" },
      { href: "/admin/roles", labelKey: "roles", permission: "role.view" },
      {
        href: "/admin/document-categories",
        labelKey: "documentTypes",
        permission: "settings.manage",
      },
      { href: "/admin/audit", labelKey: "audit", permission: "audit.view" },
    ],
  },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const principal = await requireUser();
  const [t, tc, ts, locale] = await Promise.all([
    getTranslations("nav"),
    getTranslations("common"),
    getTranslations("search"),
    currentLocale(),
  ]);

  // Searching is pointless for someone who can reach none of the things it searches.
  const canSearch =
    can(principal, "customer.view") ||
    can(principal, "supplier.view") ||
    can(principal, "vehicle.view") ||
    can(principal, "document.view");

  // Notifications are not gated by one permission: they are visible to anyone who can
  // see at least one kind of notification, which is a question about the catalogue
  // rather than a single key.
  const notificationTypes = visibleTypes(principal);
  const unread = notificationTypes.length > 0 ? await unreadCount(principal) : 0;

  const groups: NavGroup[] = NAV_DEFINITION.map((group) => {
    const items: NavItem[] = group.items
      .filter((item) => can(principal, item.permission))
      .map(({ href, labelKey }) => ({ href, label: t(labelKey) }));

    if (group.labelKey === "overview" && notificationTypes.length > 0) {
      items.push({
        href: "/notifications",
        label: t("notifications"),
        badge: unread > 0 ? unread : undefined,
      });
    }

    return { label: t(group.labelKey), items };
  }).filter((group) => group.items.length > 0);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">DrivenX</span>
          <span className="brand-sub">{tc("brandSub")}</span>
        </div>

        {canSearch ? (
          /* A plain GET form: results stay linkable and it works before JavaScript loads,
             which matters for the one control staff use most. */
          <form action="/search" method="get" className="sidebar-search" role="search">
            <input
              type="search"
              name="q"
              aria-label={ts("label")}
              placeholder={ts("placeholder")}
            />
          </form>
        ) : null}

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
