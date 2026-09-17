"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("roles");
  const tc = useTranslations("common");
  const grantedSet = new Set(granted);

  return (
    <form action={formAction}>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      {groups.map((group, index) => {
        // A labelled group rather than fieldset/legend. A legend cannot be made to span
        // its fieldset as a header bar without floating it, and that float took the full
        // width and collapsed the rows beside it to zero, pushing every permission
        // outside its own box: present, clickable, and invisible to a person.
        const headingId = `perm-group-${index}`;

        return (
          <div key={group.group} className="perm-group" role="group" aria-labelledby={headingId}>
            <div className="perm-group-head" id={headingId}>
              {group.group}
            </div>
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
                    {/* The identifier used in the code, the same in every language. */}
                    <span className="perm-item-key" dir="ltr">
                      {permission.key}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        );
      })}

      {readOnly ? (
        <p className="muted">{t("readOnly")}</p>
      ) : (
        <SubmitButton pendingLabel={tc("saving")}>{t("save")}</SubmitButton>
      )}
    </form>
  );
}
