import { cache } from "react";
import { forbidden, redirect } from "next/navigation";
import { headers } from "next/headers";

import { can, type PermissionKey, type Principal } from "@drivenx/auth";
import { loadPrincipal } from "@drivenx/auth/session";
import { withAuditContext } from "@drivenx/db";

import { sessionUserId } from "./session";

/**
 * The signed-in user, or null.
 *
 * Wrapped in React's `cache` so a page that checks permissions in several places
 * still costs one database round trip per request. Permissions are deliberately
 * loaded per request rather than carried in the session token — see
 * packages/auth/src/rbac.ts.
 */
export const currentPrincipal = cache(async (): Promise<Principal | null> => {
  const userId = await sessionUserId();
  if (!userId) return null;
  return loadPrincipal(userId);
});

/** Require a signed-in user, or bounce to the login page. */
export async function requireUser(): Promise<Principal> {
  const principal = await currentPrincipal();
  if (!principal) redirect("/login");
  return principal;
}

/**
 * Require a specific permission.
 *
 * Not signed in redirects to login; signed in but not permitted renders 403. Those
 * are different situations and conflating them either loops a legitimate user back
 * through login or tells an unauthenticated visitor that a page exists.
 */
export async function requirePermission(permission: PermissionKey): Promise<Principal> {
  const principal = await requireUser();
  if (!can(principal, permission)) forbidden();
  return principal;
}

/**
 * Run a mutation attributed to the acting user.
 *
 * Every server action that writes must go through this, or its audit rows record a
 * null actor and SOW §17's "who changed what" becomes unanswerable.
 */
export async function asActor<T>(principal: Principal, fn: () => Promise<T>): Promise<T> {
  const headerList = await headers();
  return withAuditContext(
    {
      actorId: principal.id,
      ipAddress: headerList.get("x-forwarded-for")?.split(",")[0]?.trim(),
      userAgent: headerList.get("user-agent") ?? undefined,
      requestId: headerList.get("x-request-id") ?? undefined,
    },
    fn,
  );
}
