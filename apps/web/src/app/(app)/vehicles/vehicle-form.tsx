"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";

import { UAE_EMIRATES } from "@drivenx/core";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import type { VehicleFormState } from "./actions";

export interface VehicleDefaults {
  make: string;
  model: string;
  year: string;
  variant: string;
  colour: string;
  plateEmirate: string;
  plateCode: string;
  plateNumber: string;
  vin: string;
  ownershipType: "COMPANY_OWNED" | "B2B_SUPPLIER";
  supplierId: string;
  sourceDate: string;
  /** Strings, not bigints: a bigint cannot cross from a server component to a client one. */
  purchasePrice: string;
  supplierMonthlyCost: string;
  notes: string;
}

const GRID = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 16,
} as const;

export function VehicleForm({
  action,
  suppliers,
  defaults,
  mode,
}: {
  action: (state: VehicleFormState, formData: FormData) => Promise<VehicleFormState>;
  suppliers: { id: string; label: string }[];
  defaults?: VehicleDefaults;
  mode: "create" | "edit";
}) {
  const [state, formAction] = useActionState<VehicleFormState, FormData>(action, {});
  const t = useTranslations("vehicles.form");
  const tEmirates = useTranslations("vehicles.emirates");
  const tOwnership = useTranslations("vehicles.ownership");

  // The cost fields follow the ownership, so the form never asks for a purchase price on
  // a car DrivenX does not own, or a monthly supplier cost on one it does.
  const [ownership, setOwnership] = useState(defaults?.ownershipType ?? "COMPANY_OWNED");

  return (
    <form action={formAction} noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <h3 className="form-section">{t("identity")}</h3>
      <div style={GRID}>
        <Field label={t("make")} name="make" required defaultValue={defaults?.make} />
        <Field label={t("model")} name="model" required defaultValue={defaults?.model} />
        <Field
          label={t("year")}
          name="year"
          type="number"
          required
          dir="ltr"
          defaultValue={defaults?.year}
        />
        <Field label={t("variant")} name="variant" defaultValue={defaults?.variant} />
        <Field label={t("colour")} name="colour" defaultValue={defaults?.colour} />
      </div>

      <h3 className="form-section">{t("registration")}</h3>
      <div style={GRID}>
        <div className="field">
          <label htmlFor="plateEmirate">
            {t("plateEmirate")}
            <span aria-hidden="true"> *</span>
          </label>
          <select id="plateEmirate" name="plateEmirate" defaultValue={defaults?.plateEmirate ?? "DUBAI"}>
            {UAE_EMIRATES.map((emirate) => (
              <option key={emirate} value={emirate}>
                {tEmirates(emirate)}
              </option>
            ))}
          </select>
        </div>
        <Field
          label={t("plateCode")}
          name="plateCode"
          required
          dir="ltr"
          hint={t("plateCodeHint")}
          defaultValue={defaults?.plateCode}
        />
        <Field
          label={t("plateNumber")}
          name="plateNumber"
          required
          dir="ltr"
          defaultValue={defaults?.plateNumber}
        />
        <Field
          label={t("vin")}
          name="vin"
          required
          dir="ltr"
          hint={t("vinHint")}
          defaultValue={defaults?.vin}
        />
        {mode === "create" ? (
          <Field
            label={t("mileage")}
            name="currentMileageKm"
            type="number"
            dir="ltr"
            hint={t("mileageHint")}
            defaultValue="0"
          />
        ) : null}
      </div>

      <h3 className="form-section">{t("ownershipTitle")}</h3>
      <div className="field" role="radiogroup" aria-labelledby="ownership-label">
        <span className="field-label" id="ownership-label">
          {t("ownershipType")}
        </span>
        <div className="row" style={{ flexWrap: "wrap", gap: 18 }}>
          {(["COMPANY_OWNED", "B2B_SUPPLIER"] as const).map((value) => (
            <label key={value} className="checkbox-row">
              <input
                type="radio"
                name="ownershipType"
                value={value}
                checked={ownership === value}
                onChange={() => setOwnership(value)}
              />
              <span>{tOwnership(value)}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={GRID}>
        {ownership === "B2B_SUPPLIER" ? (
          <>
            <div className="field">
              <label htmlFor="supplierId">
                {t("supplier")}
                <span aria-hidden="true"> *</span>
              </label>
              <select id="supplierId" name="supplierId" defaultValue={defaults?.supplierId ?? ""}>
                <option value="" disabled>
                  {t("chooseSupplier")}
                </option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.label}
                  </option>
                ))}
              </select>
            </div>
            <Field
              label={t("supplierMonthlyCost")}
              name="supplierMonthlyCost"
              required
              dir="ltr"
              hint={t("moneyHint")}
              defaultValue={defaults?.supplierMonthlyCost}
            />
          </>
        ) : (
          <Field
            label={t("purchasePrice")}
            name="purchasePrice"
            dir="ltr"
            hint={t("moneyHint")}
            defaultValue={defaults?.purchasePrice}
          />
        )}
        <Field
          label={t("sourceDate")}
          name="sourceDate"
          type="date"
          dir="ltr"
          defaultValue={defaults?.sourceDate}
        />
      </div>

      <div className="field">
        <label htmlFor="notes">{t("notes")}</label>
        <textarea id="notes" name="notes" rows={3} defaultValue={defaults?.notes} />
      </div>

      <SubmitButton pendingLabel={t(mode === "create" ? "submitting" : "saving")}>
        {t(mode === "create" ? "submit" : "save")}
      </SubmitButton>
    </form>
  );
}
