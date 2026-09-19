"use client";

import { useActionState, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { buildSchedule, scheduleTotals } from "@drivenx/core/contracts";
import { format as formatMoney, parse, toDecimalString, type Fils } from "@drivenx/core/money";
import { LEASE_TO_OWN_BUYOUT } from "@drivenx/core/pricing";

import { Alert } from "@/components/alert";
import { Field, SubmitButton } from "@/components/form";

import type { LeadFormState } from "../actions";

type Action = (state: LeadFormState, formData: FormData) => Promise<LeadFormState>;

const TYPES = ["LONG_TERM_RENTAL", "LEASE_TO_OWN", "B2B_RENTAL", "OTHER"] as const;
type DealType = (typeof TYPES)[number];

const GRID = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: 12,
} as const;

function tryParse(value: string): Fils | undefined {
  if (value.trim() === "") return undefined;
  try {
    return parse(value);
  } catch {
    return undefined;
  }
}

/** Move the lead by hand. Choosing Lost asks why, because the funnel report groups on it. */
export function StatusForm({ action, options }: { action: Action; options: Array<{ value: string; label: string }> }) {
  const [state, formAction] = useActionState<LeadFormState, FormData>(action, {});
  const [to, setTo] = useState(options[0]?.value ?? "");
  const t = useTranslations("leads.detail");

  return (
    <form action={formAction} className="row" style={{ gap: 12, alignItems: "end", flexWrap: "wrap" }}>
      {state.error ? (
        <div style={{ flexBasis: "100%" }}>
          <Alert tone="error">{state.error}</Alert>
        </div>
      ) : null}
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="status">{t("moveTo")}</label>
        <select id="status" name="status" value={to} onChange={(e) => setTo(e.target.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {to === "LOST" ? (
        <div className="field" style={{ marginBottom: 0, flex: "1 1 240px" }}>
          <label htmlFor="reason">{t("lostReason")}</label>
          <input id="reason" name="reason" />
        </div>
      ) : null}
      <SubmitButton variant="secondary" pendingLabel={t("moving")}>
        {t("move")}
      </SubmitButton>
    </form>
  );
}

/**
 * Price a deal for the lead. The total shown is from the same function that writes a
 * contract's schedule, so the customer is quoted what they will be invoiced.
 */
export function QuoteForm({
  action,
  vehicles,
  defaults,
}: {
  action: Action;
  vehicles: Array<{ id: string; label: string; ownership: "COMPANY_OWNED" | "B2B_SUPPLIER" }>;
  defaults: { vehicleId: string; durationMonths: string; monthlyRental: string };
}) {
  const [state, formAction] = useActionState<LeadFormState, FormData>(action, {});
  const t = useTranslations("leads.quote");
  const td = useTranslations("leads.detail");
  const tTypes = useTranslations("contracts.types");

  const [vehicleId, setVehicleId] = useState(defaults.vehicleId);
  const [type, setType] = useState<DealType>("LONG_TERM_RENTAL");
  const [duration, setDuration] = useState(defaults.durationMonths || "36");
  const [rental, setRental] = useState(defaults.monthlyRental);
  const [down, setDown] = useState("");
  const [insurance, setInsurance] = useState("");
  const [buyout, setBuyout] = useState(toDecimalString(LEASE_TO_OWN_BUYOUT));

  const leasedIn = vehicles.find((v) => v.id === vehicleId)?.ownership === "B2B_SUPPLIER";
  const effectiveType: DealType = leasedIn ? "LEASE_TO_OWN" : type;

  const preview = useMemo(() => {
    const months = Number(duration);
    const monthly = tryParse(rental);
    if (!Number.isInteger(months) || months < 1 || months > 120 || monthly === undefined || monthly <= 0n) return null;
    // Any start date gives the same totals; the contract's own is chosen at conversion.
    const schedule = buildSchedule({
      startDate: "2026-01-01",
      durationMonths: months,
      monthlyRental: monthly,
      downPayment: tryParse(down),
      annualInsurance: tryParse(insurance),
      buyout: effectiveType === "LEASE_TO_OWN" ? tryParse(buyout) : undefined,
    });
    return { count: schedule.length, ...scheduleTotals(schedule) };
  }, [duration, rental, down, insurance, buyout, effectiveType]);

  return (
    <form action={formAction} noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <div style={GRID}>
        <div className="field">
          <label htmlFor="vehicleId">{t("vehicle")}</label>
          <select id="vehicleId" name="vehicleId" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="" disabled>
              {t("chooseVehicle")}
            </option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="durationMonths">{t("duration")}</label>
          <input
            id="durationMonths"
            name="durationMonths"
            type="number"
            dir="ltr"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="monthlyRental">{t("monthly")}</label>
          <input
            id="monthlyRental"
            name="monthlyRental"
            inputMode="decimal"
            dir="ltr"
            value={rental}
            onChange={(e) => setRental(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="downPayment">{t("down")}</label>
          <input id="downPayment" name="downPayment" inputMode="decimal" dir="ltr" value={down} onChange={(e) => setDown(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="annualInsurance">{t("insurance")}</label>
          <input
            id="annualInsurance"
            name="annualInsurance"
            inputMode="decimal"
            dir="ltr"
            value={insurance}
            onChange={(e) => setInsurance(e.target.value)}
          />
        </div>
        {effectiveType === "LEASE_TO_OWN" ? (
          <div className="field">
            <label htmlFor="buyout">{t("buyout")}</label>
            <input id="buyout" name="buyout" inputMode="decimal" dir="ltr" value={buyout} onChange={(e) => setBuyout(e.target.value)} />
          </div>
        ) : null}
      </div>

      <div className="field" role="radiogroup" aria-labelledby="deal-type-label">
        <span className="field-label" id="deal-type-label">
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

      <p className={preview ? undefined : "muted"} aria-live="polite">
        {preview
          ? t("preview", { count: preview.count, net: formatMoney(preview.netFils), gross: formatMoney(preview.grossFils) })
          : t("previewPrompt")}
      </p>
      <SubmitButton pendingLabel={td("savingPrice")}>{td("savePrice")}</SubmitButton>
    </form>
  );
}

export function ConvertForm({ action, today }: { action: Action; today: string }) {
  const [state, formAction] = useActionState<LeadFormState, FormData>(action, {});
  const t = useTranslations("leads.detail");
  return (
    <form action={formAction} className="row" style={{ gap: 12, alignItems: "end", flexWrap: "wrap" }}>
      {state.error ? (
        <div style={{ flexBasis: "100%" }}>
          <Alert tone="error">{state.error}</Alert>
        </div>
      ) : null}
      <Field label={t("startDate")} name="startDate" type="date" dir="ltr" defaultValue={today} />
      <SubmitButton pendingLabel={t("converting")}>{t("convert")}</SubmitButton>
    </form>
  );
}
