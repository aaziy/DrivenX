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

const SETTLEMENT_REASONS = ["EARLY_TERMINATION", "END_OF_TERM", "RETURN"] as const;
const SETTLEMENT_CHARGE_TYPES = ["EXCESS_MILEAGE", "DAMAGE", "FEE", "OTHER"] as const;

/** Opens the reckoning: why it is ending, and what the odometer read on return. */
export function OpenSettlementForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState<ContractFormState, FormData>(action, {});
  const t = useTranslations("settlements");

  return (
    <form action={formAction} className="row" style={{ gap: 12, alignItems: "end", flexWrap: "wrap" }}>
      {state.error ? (
        <div style={{ flexBasis: "100%" }}>
          <Alert tone="error">{state.error}</Alert>
        </div>
      ) : null}
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="reason">{t("reason")}</label>
        <select id="reason" name="reason" defaultValue="EARLY_TERMINATION">
          {SETTLEMENT_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {t(`reasons.${reason}`)}
            </option>
          ))}
        </select>
      </div>
      <Field label={t("returnedMileage")} name="returnedMileageKm" type="number" dir="ltr" />
      <SubmitButton pendingLabel={t("opening")}>{t("open")}</SubmitButton>
    </form>
  );
}

/** One more thing owed, or one thing taken off. */
export function SettlementLineForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState<ContractFormState, FormData>(action, {});
  const [kind, setKind] = useState<"CHARGE" | "CREDIT">("CHARGE");
  const t = useTranslations("settlements");

  return (
    <form action={formAction} className="row" style={{ gap: 12, alignItems: "end", flexWrap: "wrap" }}>
      {state.error ? (
        <div style={{ flexBasis: "100%" }}>
          <Alert tone="error">{state.error}</Alert>
        </div>
      ) : null}
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="kind">{t("kind")}</label>
        <select id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as "CHARGE" | "CREDIT")}>
          {(["CHARGE", "CREDIT"] as const).map((value) => (
            <option key={value} value={value}>
              {t(`kinds.${value}`)}
            </option>
          ))}
        </select>
      </div>
      {kind === "CHARGE" ? (
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="chargeType">{t("chargeType")}</label>
          <select id="chargeType" name="chargeType" defaultValue="EXCESS_MILEAGE">
            {SETTLEMENT_CHARGE_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`chargeTypes.${type}`)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="field" style={{ marginBottom: 0, flex: "1 1 200px" }}>
        <label htmlFor="label">{t("label")}</label>
        <input id="label" name="label" required />
      </div>
      {/* Its own id: the payment form on this page also has an "amount" field. */}
      <Field label={t("amount")} name="amount" id="settlementAmount" required dir="ltr" />
      <SubmitButton variant="secondary" pendingLabel={t("adding")}>
        {t("addLine")}
      </SubmitButton>
    </form>
  );
}

/** A one-button form: removing a line, settling, and other acts with nothing to fill in. */
export function ActionButton({
  action,
  label,
  pendingLabel,
  variant = "secondary",
}: {
  action: Action;
  label: string;
  pendingLabel: string;
  variant?: "primary" | "secondary";
}) {
  const [state, formAction] = useActionState<ContractFormState, FormData>(action, {});
  return (
    <form action={formAction} className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <SubmitButton variant={variant} pendingLabel={pendingLabel}>
        {label}
      </SubmitButton>
      {state.error ? <span className="field-error">{state.error}</span> : null}
    </form>
  );
}

/** Ends the contract: how it ended, and where the car goes. */
export function TerminateForm({ action, canSell }: { action: Action; canSell: boolean }) {
  const [state, formAction] = useActionState<ContractFormState, FormData>(action, {});
  const t = useTranslations("settlements");

  return (
    <form action={formAction} className="row" style={{ gap: 12, alignItems: "end", flexWrap: "wrap" }}>
      {state.error ? (
        <div style={{ flexBasis: "100%" }}>
          <Alert tone="error">{state.error}</Alert>
        </div>
      ) : null}
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="outcome">{t("outcome")}</label>
        <select id="outcome" name="outcome" defaultValue="EARLY_TERMINATION">
          {(["EARLY_TERMINATION", "END_OF_TERM"] as const).map((outcome) => (
            <option key={outcome} value={outcome}>
              {t(`outcomes.${outcome}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="vehicleTo">{t("vehicleTo")}</label>
        <select id="vehicleTo" name="vehicleTo" defaultValue="RETURNED">
          <option value="RETURNED">{t("vehicleTargets.RETURNED")}</option>
          {/* Ownership transfers only on a lease-to-own, and only from that status. */}
          {canSell ? <option value="SOLD">{t("vehicleTargets.SOLD")}</option> : null}
        </select>
      </div>
      <SubmitButton pendingLabel={t("ending")}>{t("end")}</SubmitButton>
    </form>
  );
}
