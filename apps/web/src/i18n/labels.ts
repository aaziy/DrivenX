/**
 * Message keys for text that lives in the database rather than in the code.
 *
 * The rule: what the system seeded is shown in the reader's language; what a person
 * typed is shown exactly as they typed it. So a seeded role still carrying its seeded
 * name is translated, and one an administrator has renamed keeps their wording.
 */

import { DEFAULT_ROLES } from "@drivenx/auth/permissions";

export interface RoleLike {
  key: string;
  name: string;
  description?: string | null;
  isSystem: boolean;
}

function seededDefinition(role: RoleLike) {
  return role.isSystem ? DEFAULT_ROLES.find((definition) => definition.key === role.key) : undefined;
}

/** The role key to translate the name under, or null once it has been renamed. */
export function seededRoleKey(role: RoleLike): string | null {
  const definition = seededDefinition(role);
  return definition && definition.name === role.name ? definition.key : null;
}

/** The role key to translate the description under, or null once it has been edited. */
export function seededRoleDescriptionKey(role: RoleLike): string | null {
  const definition = seededDefinition(role);
  return definition && definition.description === role.description ? definition.key : null;
}

/** "lead.view_all" -> "permissions.lead.view_all": permission keys are already a path. */
export function permissionMessageKey(permissionKey: string): string {
  return `permissions.${permissionKey}`;
}

/** "Administration" -> "permissionGroups.administration". */
export function permissionGroupMessageKey(group: string): string {
  return `permissionGroups.${group.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}
