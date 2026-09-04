"use client";

import { useActionState } from "react";

import { Alert } from "@/components/alert";
import { SubmitButton } from "@/components/form";

import { updateRolePermissions, type RoleFormState } from "../actions";

interface PermissionGroup {
  group: string;
  items: Array<{ id: string; key: string; description: string }>;
}

export function PermissionEditor({
  roleId,
  groups,
  granted,
  readOnly,
}: {
  roleId: string;
  groups: PermissionGroup[];
  granted: string[];
  readOnly: boolean;
}) {
  const action = updateRolePermissions.bind(null, roleId);
  const [state, formAction] = useActionState<RoleFormState, FormData>(action, {});
  const grantedSet = new Set(granted);

  return (
    <form action={formAction}>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      {groups.map((group) => (
        <fieldset
          key={group.group}
          className="perm-group"
          style={{ border: undefined, margin: undefined, padding: 0 }}
        >
          <legend className="perm-group-head" style={{ width: "100%", float: "left" }}>
            {group.group}
          </legend>
          <div className="perm-list">
            {group.items.map((permission) => (
              <label className="perm-item" key={permission.id}>
                <input
                  type="checkbox"
                  name="permission"
                  value={permission.id}
                  defaultChecked={grantedSet.has(permission.id)}
                  disabled={readOnly}
                />
                <span>
                  <span className="perm-item-name">{permission.description}</span>
                  <br />
                  <span className="perm-item-key">{permission.key}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      {readOnly ? (
        <p className="muted">You do not have permission to change role assignments.</p>
      ) : (
        <SubmitButton pendingLabel="Saving…">Save permissions</SubmitButton>
      )}
    </form>
  );
}
