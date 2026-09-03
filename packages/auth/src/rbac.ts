/**
 * Permission checking.
 *
 * Design decision — permissions are resolved per request, not baked into the session
 * token. SOW §2 requires the Super Admin to reconfigure roles at runtime, and the
 * P0-07 exit test requires a grant or revoke to take effect *without the affected user
 * re-logging in*. A JWT carrying a permission array cannot do that: it stays valid,
 * and stale, until it expires. So the session carries only the user id, and the
 * permission set is loaded from the database on each request (see `loadPermissions`).
 *
 * The cost is one indexed join per request. The benefit is that revoking access
 * actually revokes access — which, for a system holding customer Emirates IDs and
 * payment records, is the correct trade.
 */

import type { PermissionKey } from "./permissions";

/** A user with their permissions already resolved for this request. */
export interface Principal {
  id: string;
  email: string;
  fullName: string;
  /** Resolved union of every permission across all the user's roles. */
  permissions: ReadonlySet<string>;
  roleKeys: readonly string[];
  isActive: boolean;
}

export class PermissionDeniedError extends Error {
  readonly permission: string;
  readonly userId: string;

  constructor(userId: string, permission: string) {
    super(`Permission denied: "${permission}"`);
    this.name = "PermissionDeniedError";
    this.permission = permission;
    this.userId = userId;
  }
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "NotAuthenticatedError";
  }
}

/** Does this principal hold the permission? Inactive users hold nothing. */
export function can(principal: Principal | null, permission: PermissionKey): boolean {
  if (!principal || !principal.isActive) return false;
  return principal.permissions.has(permission);
}

/** Holds at least one of the permissions. */
export function canAny(
  principal: Principal | null,
  ...permissions: readonly PermissionKey[]
): boolean {
  return permissions.some((permission) => can(principal, permission));
}

/** Holds every one of the permissions. An empty list is vacuously true. */
export function canAll(
  principal: Principal | null,
  ...permissions: readonly PermissionKey[]
): boolean {
  return permissions.every((permission) => can(principal, permission));
}

/**
 * Assert a permission, narrowing `Principal | null` to `Principal`.
 *
 * Every mutation and every route handler starts with one of these — DoD §3.1 requires
 * a permission check on each one.
 */
export function requirePermission(
  principal: Principal | null,
  permission: PermissionKey,
): asserts principal is Principal {
  if (!principal) throw new NotAuthenticatedError();
  if (!can(principal, permission)) {
    throw new PermissionDeniedError(principal.id, permission);
  }
}

/** Build a Principal from raw role rows. Used by the session loader and by tests. */
export function buildPrincipal(input: {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  roles: readonly { key: string; permissions: readonly string[] }[];
}): Principal {
  const permissions = new Set<string>();
  for (const role of input.roles) {
    for (const permission of role.permissions) {
      permissions.add(permission);
    }
  }

  return {
    id: input.id,
    email: input.email,
    fullName: input.fullName,
    isActive: input.isActive,
    permissions,
    roleKeys: input.roles.map((role) => role.key),
  };
}
