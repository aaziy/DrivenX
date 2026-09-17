"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Sidebar navigation.
 *
 * The groups arrive already filtered by permission and already translated from the
 * server layout — this component never decides what a user may see. Filtering here
 * would put an authorisation decision in the browser, where it can be edited.
 */
export function Nav({ groups, ariaLabel }: { groups: NavGroup[]; ariaLabel: string }) {
  const pathname = usePathname();

  const isCurrent = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav aria-label={ariaLabel}>
      {groups.map((group) => (
        <div key={group.label}>
          <div className="nav-group-label">{group.label}</div>
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="nav-link"
              aria-current={isCurrent(item.href) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
