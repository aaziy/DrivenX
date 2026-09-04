"use client";

import { useActionState } from "react";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import { createUser, type UserFormState } from "./actions";

export function CreateUserForm({ roles }: { roles: { id: string; name: string }[] }) {
  const [state, formAction] = useActionState<UserFormState, FormData>(createUser, {});

  return (
    <form action={formAction} noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <Field label="Full name" name="fullName" required autoComplete="off" />
        <Field label="Email" name="email" type="email" required autoComplete="off" />
        <Field
          label="Temporary password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          hint="At least 12 characters, with upper case, lower case and a digit."
        />
        <div className="field">
          <label htmlFor="roleId">
            Role<span aria-hidden="true"> *</span>
          </label>
          <select id="roleId" name="roleId" required defaultValue="">
            <option value="" disabled>
              Choose a role…
            </option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <SubmitButton pendingLabel="Creating…">Create user</SubmitButton>
    </form>
  );
}
