"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/**
 * Form primitives (P0-11).
 *
 * `SubmitButton` reads `useFormStatus`, so every form gets a disabled, pending state
 * without the caller wiring one up. Double submission on a slow connection would
 * otherwise create duplicate records — which for payments in milestone 1D is not a
 * cosmetic problem.
 */

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={variant === "primary" ? "btn-primary" : "btn-secondary"}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}

export function Field({
  label,
  name,
  type = "text",
  required,
  hint,
  error,
  defaultValue,
  autoComplete,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  defaultValue?: string;
  autoComplete?: string;
  placeholder?: string;
}) {
  const hintId = hint ? `${name}-hint` : undefined;
  const errorId = error ? `${name}-error` : undefined;

  return (
    <div className="field">
      <label htmlFor={name}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        aria-invalid={error ? true : undefined}
      />
      {hint ? (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="field-error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
