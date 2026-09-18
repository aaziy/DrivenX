"use client";

import { useActionState, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { buildSchedule, isIsoDate, scheduleTotals } from "@drivenx/core/contracts";
import { format as formatMoney, parse, toDecimalString, type Fils } from "@drivenx/core/money";
import { LEASE_TO_OWN_BUYOUT } from "@drivenx/core/pricing";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import type { ContractFormState } from "../actions";

export interface CustomerOption {
  id: string;
  label: string;
}

export interface VehicleOption {
  id: string;
  label: string;
  ownership: "COMPANY_OWNED" | "B2B_SUPPLIER";
}

const TYPES = ["LONG_TERM_RENTAL", "LEASE_TO_OWN", "B2B_RENTAL", "OTHER"] as const;
type ContractType = (typeof TYPES)[number];

const GRID = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 14,
} as const;

function tryParse(value: string): Fils | undefined {
  if (value.trim() === "") return undefined;
  try {
    return parse(value);
  } catch {
    return undefined;
  }
}

export function ContractForm({
  action,
  customers,
  vehicles,
  today,
}: {
  action: (state: ContractFormState, formData: FormData) => Promise<ContractFormState>;
  customers: CustomerOption[];
  vehicles: VehicleOption[];
  today: string;
}) {
  const [state, formAction] = useActionState<ContractFormState, FormData>(action, {});
  const t = useTranslations("contracts.form");
  const tTypes = useTranslations("contracts.types");

  const [vehicleId, setVehicleId] = useState("");
  const [type, setType] = useState<ContractType>("LONG_TERM_RENTAL");
  const [startDate, setStartDate] = useState(today);
  const [duration, setDuration] = useState("36");
  const [rental, setRental] = useState("");
  const [down, setDown] = useState("");
  const [insurance, setInsurance] = useState("");
  const [buyout, setBuyout] = useState(toDecimalString(LEASE_TO_OWN_BUYOUT));

  const vehicle = vehicles.find((candidate) => candidate.id === vehicleId);
  // A car leased from a supplier goes to a customer only on lease-to-own (2026-09-18).
  const leasedIn = vehicle?.ownership === "B2B_SUPPLIER";
  const effectiveType: ContractType = leasedIn ? "LEASE_TO_OWN" : type;

  /**
   * The schedule this contract will have — from the same function activation uses, so
   * the preview cannot disagree with what is generated.
   */
  const preview = useMemo(() => {
    const months = Number(duration);
    const monthly = tryParse(rental);
    if (!isIsoDate(startDate) || !Number.isInteger(months) || months < 1 || months > 120 || monthly === undefined) {
      return null;
    }
    const schedule = buildSchedule({
      startDate,
      durationMonths: months,
      monthlyRental: monthly,
      downPayment: tryParse(down),
      annualInsurance: tryParse(insurance),
      buyout: effectiveType === "LEASE_TO_OWN" ? tryParse(buyout) : undefined,
    });
    return { count: schedule.length, ...scheduleTotals(schedule), last: schedule.at(-1)?.periodEnd };
  }, [startDate, duration, rental, down, insurance, buyout, effectiveType]);

  return (
    <form action={formAction} noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <h3 className="form-section">{t("parties")}</h3>
      <div style={GRID}>
        <div className="field">
          <label htmlFor="customerId">
            {t("customer")}
            <span aria-hidden="true"> *</span>
          </label>
          <select id="customerId" name="customerId" defaultValue="">
            <option value="" disabled>
              {t("chooseCustomer")}
            </option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="vehicleId">
            {t("vehicle")}
            <span aria-hidden="true"> *</span>
          </label>
          <select id="vehicleId" name="vehicleId" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="" disabled>
              {t("chooseVehicle")}
            </option>
            {vehicles.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field" role="radiogroup" aria-labelledby="type-label">
        <span className="field-label" id="type-label">
          {t("type")}
        </span>
        <div className="row" style={{ gap: 18, flexWrap: "wrap" }}>
          {TYPES.map((value) => (
            <label key={value} className="checkbox-row">
              <input
                type="radio"
                name="type"
                value={value}
                checked={effectiveType === value}
                disabled={leasedIn && value !== "LEASE_TO_OWN"}
                onChange={() => setType(value)}
              />
              <span>{tTypes(value)}</span>
            </label>
          ))}
        </div>
        {leasedIn ? <span className="field-hint">{t("leasedOnlyLto")}</span> : null}
      </div>

      <h3 className="form-section">{t("termsTitle")}</h3>
      <div style={GRID}>
        <div className="field">
          <label htmlFor="startDate">{t("startDate")}</label>
          <input id="startDate" name="startDate" type="date" dir="ltr" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="durationMonths">{t("duration")}</label>
          <input id="durationMonths" name="durationMonths" type="number" dir="ltr" value={duration} onChange={(e) => setDuration(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="monthlyRental">
            {t("monthlyRental")}
            <span aria-hidden="true"> *</span>
          </label>
          <input id="monthlyRental" name="monthlyRental" inputMode="decimal" dir="ltr" value={rental} onChange={(e) => setRental(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="downPayment">{t("downPayment")}</label>
          <input id="downPayment" name="downPayment" inputMode="decimal" dir="ltr" value={down} onChange={(e) => setDown(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="annualInsurance">{t("annualInsurance")}</label>
          <input id="annualInsurance" name="annualInsurance" inputMode="decimal" dir="ltr" value={insurance} onChange={(e) => setInsurance(e.target.value)} />
        </div>
        {effectiveType === "LEASE_TO_OWN" ? (
          <div className="field">
            <label htmlFor="buyout">{t("buyout")}</label>
            <input id="buyout" name="buyout" inputMode="decimal" dir="ltr" value={buyout} onChange={(e) => setBuyout(e.target.value)} />
          </div>
        ) : null}
        <Field label={t("mileageAllowance")} name="mileageAllowanceKm" dir="ltr" />
        <Field label={t("excessMileageRate")} name="excessMileageRate" dir="ltr" hint={t("excessMileageRateHint")} />
      </div>

      <div className="field">
        <label htmlFor="terms">{t("terms")}</label>
        <textarea id="terms" name="terms" rows={3} />
      </div>

      <div className="card" style={{ background: "var(--surface-2)", marginBlock: 14 }} aria-live="polite">
        <div className="card-body">
          {preview ? (
            <p style={{ margin: 0 }}>
              {t("preview", {
                count: preview.count,
                net: formatMoney(preview.netFils),
                gross: formatMoney(preview.grossFils),
                end: preview.last ?? "",
              })}
            </p>
          ) : (
            <p className="muted" style={{ margin: 0 }}>{t("previewPrompt")}</p>
          )}
        </div>
      </div>

      <SubmitButton pendingLabel={t("submitting")}>{t("submit")}</SubmitButton>
    </form>
  );
}
