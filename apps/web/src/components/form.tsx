"use client";

import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("common");

  return (
    <button
      type="submit"
      className={variant === "primary" ? "btn-primary" : "btn-secondary"}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? (pendingLabel ?? t("working")) : children}
    </button>
  );
}

export function Field({
  label,
  name,
  id = name,
  type = "text",
  required,
  hint,
  error,
  defaultValue,
  autoComplete,
  placeholder,
  dir,
}: {
  label: string;
  name: string;
  /** Defaults to the name; set it when two forms on one page share field names. */
  id?: string;
  type?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  defaultValue?: string;
  autoComplete?: string;
  placeholder?: string;
  /** Email addresses and passwords are typed left-to-right whatever the page language. */
  dir?: "ltr" | "rtl" | "auto";
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        placeholder={placeholder}
        dir={dir}
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
