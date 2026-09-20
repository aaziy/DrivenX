"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import type { ContractFormState } from "../actions";

type Action = (state: ContractFormState, formData: FormData) => Promise<ContractFormState>;

export function ActivateForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState<ContractFormState, FormData>(action, {});
  const t = useTranslations("contracts.detail");

  return (
    <form action={formAction}>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      <SubmitButton pendingLabel={t("activating")}>{t("activate")}</SubmitButton>
    </form>
  );
}

const METHODS = ["BANK_TRANSFER", "CASH", "CARD", "TAMARA", "TABBY", "OTHER"] as const;

export function PaymentForm({ action, today }: { action: Action; today: string }) {
  const [state, formAction] = useActionState<ContractFormState, FormData>(action, {});
  const t = useTranslations("contracts.payment");
  const tMethods = useTranslations("contracts.methods");

  return (
    <form action={formAction}>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 12,
        }}
      >
        <Field label={t("amount")} name="amount" required dir="ltr" hint={t("amountHint")} />
        <Field label={t("receivedOn")} name="receivedOn" type="date" dir="ltr" defaultValue={today} />
        <div className="field">
          <label htmlFor="method">{t("method")}</label>
          <select id="method" name="method" defaultValue="BANK_TRANSFER">
            {METHODS.map((method) => (
              <option key={method} value={method}>
                {tMethods(method)}
              </option>
            ))}
          </select>
        </div>
        <Field label={t("reference")} name="reference" dir="ltr" />
      </div>
      <SubmitButton pendingLabel={t("recording")}>{t("record")}</SubmitButton>
    </form>
  );
}

/**
 * Waiving forgives money, so it asks for a reason every time and keeps the control
 * folded away until someone means to use it.
 */
export function WaiveForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState<ContractFormState, FormData>(action, {});
  const [open, setOpen] = useState(false);
  const t = useTranslations("contracts.waive");

  if (state.success) return <span className="muted" style={{ fontSize: 12.5 }}>{state.success}</span>;

  if (!open) {
    return (
      <button type="button" className="btn-link" onClick={() => setOpen(true)}>
        {t("open")}
      </button>
    );
  }

  return (
    <form action={formAction} className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input name="reason" aria-label={t("reason")} placeholder={t("reason")} style={{ width: 180 }} />
      <SubmitButton variant="secondary" pendingLabel={t("waiving")}>
        {t("confirm")}
      </SubmitButton>
      {state.error ? <span className="field-error">{state.error}</span> : null}
    </form>
  );
}

/** Pays one supplier invoice. Only invoices with something left on them are offered. */
export function SupplierPaymentForm({
  action,
  today,
  invoices,
}: {
  action: Action;
  today: string;
  invoices: { id: string; label: string }[];
}) {
  const [state, formAction] = useActionState<ContractFormState, FormData>(action, {});
  const t = useTranslations("contracts.supplier");
  const tMethods = useTranslations("contracts.methods");

  return (
    <form action={formAction}>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 12,
        }}
      >
        <div className="field">
          <label htmlFor="supplierInvoiceId">{t("invoice")}</label>
          <select id="supplierInvoiceId" name="invoiceId" defaultValue={invoices[0]?.id ?? ""}>
            <option value="">{t("chooseInvoice")}</option>
            {invoices.map((invoice) => (
              <option key={invoice.id} value={invoice.id}>
                {invoice.label}
              </option>
            ))}
          </select>
        </div>
        <Field label={t("amount")} name="amount" id="supplierAmount" required dir="ltr" />
        <Field label={t("paidOn")} name="paidOn" id="supplierPaidOn" type="date" dir="ltr" defaultValue={today} />
        <div className="field">
          <label htmlFor="supplierMethod">{t("method")}</label>
          <select id="supplierMethod" name="method" defaultValue="BANK_TRANSFER">
            {METHODS.map((method) => (
              <option key={method} value={method}>
                {tMethods(method)}
              </option>
            ))}
          </select>
        </div>
        <Field label={t("reference")} name="reference" id="supplierReference" dir="ltr" />
      </div>
      <SubmitButton pendingLabel={t("recording")}>{t("record")}</SubmitButton>
    </form>
  );
}
