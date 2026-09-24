"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";

import {
  defaultVatBasisPoints,
  EXPENSE_ALLOCATIONS,
  EXPENSE_CATEGORIES,
  type ExpenseAllocation,
  type ExpenseCategory,
} from "@drivenx/core";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import type { ExpenseFormState, recordExpenseAction } from "./actions";

const GRID = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: 12,
} as const;

/**
 * Recording a cost.
 *
 * The form asks for a car or a contract only when the allocation needs one, because a
 * field that is sometimes meaningless is a field people fill in anyway — and an overhead
 * with a car against it is the one thing the allocation exists to prevent.
 *
 * The VAT box follows the category as it changes: a registration fee carries none and
 * fuel carries five per cent, which is right far more often than whatever was typed last.
 */
export function ExpenseForm({
  action,
  today,
  vehicles,
  contracts,
}: {
  action: typeof recordExpenseAction;
  today: string;
  vehicles: Array<{ id: string; label: string }>;
  contracts: Array<{ id: string; label: string }>;
}) {
  const [state, formAction] = useActionState<ExpenseFormState, FormData>(action, {});
  const t = useTranslations("expenses");
  const [category, setCategory] = useState<ExpenseCategory>("FUEL");
  const [allocation, setAllocation] = useState<ExpenseAllocation>("VEHICLE");

  return (
    <form action={formAction} noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <div style={GRID}>
        <div className="field">
          <label htmlFor="category">{t("form.category")}</label>
          <select
            id="category"
            name="category"
            value={category}
            onChange={(event) => setCategory(event.target.value as ExpenseCategory)}
          >
            {EXPENSE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(`categories.${value}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="allocation">{t("form.allocation")}</label>
          <select
            id="allocation"
            name="allocation"
            value={allocation}
            onChange={(event) => setAllocation(event.target.value as ExpenseAllocation)}
          >
            {EXPENSE_ALLOCATIONS.map((value) => (
              <option key={value} value={value}>
                {t(`allocations.${value}`)}
              </option>
            ))}
          </select>
        </div>

        {allocation === "VEHICLE" ? (
          <div className="field">
            <label htmlFor="vehicleId">{t("form.vehicle")}</label>
            <select id="vehicleId" name="vehicleId" defaultValue="">
              <option value="">{t("form.chooseVehicle")}</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {allocation === "CONTRACT" ? (
          <div className="field">
            <label htmlFor="contractId">{t("form.contract")}</label>
            <select id="contractId" name="contractId" defaultValue="">
              <option value="">{t("form.chooseContract")}</option>
              {contracts.map((contract) => (
                <option key={contract.id} value={contract.id}>
                  {contract.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <Field label={t("form.incurredOn")} name="incurredOn" type="date" dir="ltr" required defaultValue={today} />
        <Field label={t("form.amount")} name="amount" dir="ltr" required hint={t("form.amountHint")} />
        <div className="field">
          <label htmlFor="vatBasisPoints">{t("form.vat")}</label>
          {/* Keyed on the category so it resets when the category changes: the default
              for a government charge is not the default for fuel. */}
          <select
            key={category}
            id="vatBasisPoints"
            name="vatBasisPoints"
            defaultValue={String(defaultVatBasisPoints(category))}
          >
            <option value="0">{t("form.vatNone")}</option>
            <option value="500">{t("form.vatStandard")}</option>
          </select>
        </div>
        <Field label={t("form.supplier")} name="supplierName" />
        <Field label={t("form.reference")} name="referenceNumber" dir="ltr" />
      </div>

      <div className="field">
        <label htmlFor="description">{t("form.description")}</label>
        <input id="description" name="description" required />
      </div>

      <SubmitButton pendingLabel={t("adding")}>{t("add")}</SubmitButton>
    </form>
  );
}
