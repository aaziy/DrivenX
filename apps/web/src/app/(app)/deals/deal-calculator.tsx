"use client";

import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { format as formatMoney, parse, toDecimalString, type Fils } from "@drivenx/core/money";
import {
  calculateDeal,
  LEASE_TO_OWN_BUYOUT,
  validateDealInput,
  type DealInput,
  type DealType,
} from "@drivenx/core/pricing";

type Ownership = "COMPANY_OWNED" | "B2B_SUPPLIER";

export interface VehicleOption {
  id: string;
  label: string;
  ownership: Ownership;
  /** Decimal strings: a bigint cannot cross from a server component to a client one. */
  monthlyCost: string;
  purchasePrice: string;
}

interface Fields {
  dealType: DealType;
  vehicleId: string;
  ownership: Ownership;
  durationMonths: string;
  rental: string;
  vehicleMonthlyCost: string;
  vehicleOneOffCost: string;
  downPayment: string;
  buyout: string;
  insuranceCharge: string;
  insuranceCost: string;
  maintenance: string;
  otherCosts: string;
}

type MoneyField =
  | "rental"
  | "vehicleMonthlyCost"
  | "vehicleOneOffCost"
  | "downPayment"
  | "buyout"
  | "insuranceCharge"
  | "insuranceCost"
  | "maintenance"
  | "otherCosts";

const GRID = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: 14,
} as const;

/**
 * The deal calculator (P1C-04): a thin form over the pure engine.
 *
 * Runs in the browser, so every keystroke recalculates with no round trip — and the
 * figures are those of calculateDeal() itself, the same function a contract will use, not
 * a second implementation that could drift from it.
 */
export function DealCalculator({ vehicles }: { vehicles: VehicleOption[] }) {
  const t = useTranslations("deals");
  const format = useFormatter();

  const [fields, setFields] = useState<Fields>({
    dealType: "LEASE_TO_OWN",
    vehicleId: "",
    ownership: "COMPANY_OWNED",
    durationMonths: "36",
    rental: "",
    vehicleMonthlyCost: "",
    vehicleOneOffCost: "",
    downPayment: "",
    buyout: toDecimalString(LEASE_TO_OWN_BUYOUT),
    insuranceCharge: "",
    insuranceCost: "",
    maintenance: "",
    otherCosts: "",
  });

  const set = (patch: Partial<Fields>) => setFields((current) => ({ ...current, ...patch }));

  /** Choosing a car fills in what the fleet already knows about its cost. */
  function chooseVehicle(vehicleId: string) {
    const vehicle = vehicles.find((candidate) => candidate.id === vehicleId);
    if (!vehicle) {
      set({ vehicleId: "" });
      return;
    }
    const leasedIn = vehicle.ownership === "B2B_SUPPLIER";
    set({
      vehicleId,
      ownership: vehicle.ownership,
      // A leased-in car goes to a customer only on lease-to-own (client, 2026-09-18).
      dealType: leasedIn ? "LEASE_TO_OWN" : fields.dealType,
      vehicleMonthlyCost: leasedIn ? vehicle.monthlyCost : "",
      vehicleOneOffCost:
        !leasedIn && fields.dealType === "LEASE_TO_OWN" ? vehicle.purchasePrice : "",
    });
  }

  const outcome = useMemo(() => {
    const badMoney = new Set<string>();
    const money = (field: MoneyField): Fils | undefined => {
      const raw = fields[field].trim();
      if (raw === "") return undefined;
      try {
        return parse(raw);
      } catch {
        badMoney.add(field);
        return undefined;
      }
    };

    const rental = money("rental");

    const input: DealInput = {
      dealType: fields.dealType,
      ownership: fields.ownership,
      durationMonths: fields.durationMonths.trim() === "" ? Number.NaN : Number(fields.durationMonths),
      customerMonthlyRental: rental ?? 0n,
      vehicleMonthlyCost: money("vehicleMonthlyCost"),
      vehicleOneOffCost: money("vehicleOneOffCost"),
      downPayment: money("downPayment"),
      buyoutAmount: fields.dealType === "LEASE_TO_OWN" ? money("buyout") : undefined,
      annualInsuranceCharge: money("insuranceCharge"),
      annualInsuranceCost: money("insuranceCost"),
      monthlyMaintenanceCost: money("maintenance"),
      otherCosts: money("otherCosts"),
    };

    const issues = validateDealInput(input);
    const ready = rental !== undefined && badMoney.size === 0 && issues.length === 0;

    return { badMoney, issues, result: ready ? calculateDeal(input) : null, rentalEntered: rental !== undefined };
  }, [fields]);

  const leasedIn = fields.ownership === "B2B_SUPPLIER";
  const aed = (fils: Fils) => formatMoney(fils);
  const result = outcome.result;

  const moneyField = (
    field: MoneyField,
    label: string,
    hint?: string,
  ) => (
    <div className="field">
      <label htmlFor={field}>{label}</label>
      <input
        id={field}
        name={field}
        inputMode="decimal"
        dir="ltr"
        value={fields[field]}
        onChange={(event) => set({ [field]: event.target.value } as Partial<Fields>)}
        aria-invalid={outcome.badMoney.has(field) || undefined}
      />
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
        gap: 18,
        alignItems: "start",
      }}
    >
      <div className="card">
        <div className="card-header">
          <h2>{t("inputsTitle")}</h2>
        </div>
        <div className="card-body">
          <div className="field">
            <label htmlFor="vehicleId">{t("form.vehicle")}</label>
            <select id="vehicleId" value={fields.vehicleId} onChange={(e) => chooseVehicle(e.target.value)}>
              <option value="">{t("form.noVehicle")}</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field" role="radiogroup" aria-labelledby="dealType-label">
            <span className="field-label" id="dealType-label">
              {t("form.dealType")}
            </span>
            <div className="row" style={{ gap: 18, flexWrap: "wrap" }}>
              {(["RENTAL", "LEASE_TO_OWN"] as const).map((value) => (
                <label key={value} className="checkbox-row">
                  <input
                    type="radio"
                    name="dealType"
                    value={value}
                    checked={fields.dealType === value}
                    disabled={value === "RENTAL" && leasedIn}
                    onChange={() => set({ dealType: value })}
                  />
                  <span>{t(`dealTypes.${value}`)}</span>
                </label>
              ))}
            </div>
            {leasedIn ? <span className="field-hint">{t("form.leasedOnlyLto")}</span> : null}
          </div>

          {fields.vehicleId === "" ? (
            <div className="field" role="radiogroup" aria-labelledby="ownership-label">
              <span className="field-label" id="ownership-label">
                {t("form.ownership")}
              </span>
              <div className="row" style={{ gap: 18, flexWrap: "wrap" }}>
                {(["COMPANY_OWNED", "B2B_SUPPLIER"] as const).map((value) => (
                  <label key={value} className="checkbox-row">
                    <input
                      type="radio"
                      name="ownership"
                      value={value}
                      checked={fields.ownership === value}
                      onChange={() =>
                        set({
                          ownership: value,
                          ...(value === "B2B_SUPPLIER" ? { dealType: "LEASE_TO_OWN" as const } : {}),
                        })
                      }
                    />
                    <span>{t(`ownership.${value}`)}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div style={GRID}>
            <div className="field">
              <label htmlFor="durationMonths">{t("form.duration")}</label>
              <input
                id="durationMonths"
                type="number"
                dir="ltr"
                value={fields.durationMonths}
                onChange={(e) => set({ durationMonths: e.target.value })}
              />
            </div>
            {moneyField("rental", t("form.rental"))}
            {moneyField("vehicleMonthlyCost", t("form.vehicleMonthlyCost"), t("form.vehicleMonthlyCostHint"))}
            {fields.dealType === "LEASE_TO_OWN"
              ? moneyField("vehicleOneOffCost", t("form.vehicleOneOffCost"), t("form.vehicleOneOffCostHint"))
              : null}
            {moneyField("downPayment", t("form.downPayment"))}
            {fields.dealType === "LEASE_TO_OWN" ? moneyField("buyout", t("form.buyout")) : null}
            {moneyField("insuranceCharge", t("form.insuranceCharge"))}
            {moneyField("insuranceCost", t("form.insuranceCost"), t("form.insuranceCostHint"))}
            {moneyField("maintenance", t("form.maintenance"))}
            {moneyField("otherCosts", t("form.otherCosts"))}
          </div>
        </div>
      </div>

      <div className="card" aria-live="polite">
        <div className="card-header">
          <h2>{t("results.title")}</h2>
        </div>
        <div className="card-body">
          {outcome.badMoney.size > 0 ? (
            <p className="field-error">{t("issues.money")}</p>
          ) : null}
          {outcome.issues.map((issue) => (
            <p key={`${issue.code}:${issue.field ?? ""}`} className="field-error">
              {t(`issues.${issue.code}`, issue.params ?? {})}
            </p>
          ))}

          {!outcome.rentalEntered ? (
            <p className="muted">{t("results.prompt")}</p>
          ) : result ? (
            <div className="stack" style={{ gap: 18 }}>
              <section>
                <h3 className="form-section">{t("results.monthly")}</h3>
                <table className="deal-table">
                  <tbody>
                    <tr><td>{t("results.rentalRevenue")}</td><td>{aed(result.monthly.rentalRevenue)}</td></tr>
                    <tr><td>{t("results.vehicleCost")}</td><td>{aed(result.monthly.vehicleCost)}</td></tr>
                    <tr className="deal-total">
                      <td>{t("results.grossProfit")}</td>
                      <td className={result.monthly.grossProfit < 0n ? "negative" : ""}>
                        {aed(result.monthly.grossProfit)}
                      </td>
                    </tr>
                    <tr><td>{t("results.customerPays")}</td><td>{aed(result.monthly.rentalWithVat)}</td></tr>
                  </tbody>
                </table>
              </section>

              <section>
                <h3 className="form-section">{t("results.firstYear", { months: result.firstYear.months })}</h3>
                <table className="deal-table">
                  <tbody>
                    <tr><td>{t("results.rentalRevenue")}</td><td>{aed(result.firstYear.rentalRevenue)}</td></tr>
                    <tr><td>{t("results.insuranceRevenue")}</td><td>{aed(result.firstYear.insuranceRevenue)}</td></tr>
                    <tr className="deal-total">
                      <td>{t("results.revenueInclInsurance")}</td>
                      <td>{aed(result.firstYear.revenueIncludingInsurance)}</td>
                    </tr>
                  </tbody>
                </table>
              </section>

              <section>
                <h3 className="form-section">{t("results.contract", { months: result.contract.months })}</h3>
                <table className="deal-table">
                  <tbody>
                    <tr><td>{t("results.rentalRevenue")}</td><td>{aed(result.contract.rentalRevenue)}</td></tr>
                    <tr><td>{t("results.insuranceRevenue")}</td><td>{aed(result.contract.insuranceRevenue)}</td></tr>
                    <tr><td>{t("results.downPayment")}</td><td>{aed(result.contract.downPayment)}</td></tr>
                    {fields.dealType === "LEASE_TO_OWN" ? (
                      <tr><td>{t("results.buyout")}</td><td>{aed(result.contract.buyout)}</td></tr>
                    ) : null}
                    <tr className="deal-total"><td>{t("results.totalRevenue")}</td><td>{aed(result.contract.totalRevenue)}</td></tr>
                    <tr><td>{t("results.vehicleCost")}</td><td>{aed(result.contract.vehicleCost)}</td></tr>
                    <tr><td>{t("results.insuranceCost")}</td><td>{aed(result.contract.insuranceCost)}</td></tr>
                    <tr><td>{t("results.maintenanceCost")}</td><td>{aed(result.contract.maintenanceCost)}</td></tr>
                    <tr><td>{t("results.otherCosts")}</td><td>{aed(result.contract.otherCosts)}</td></tr>
                    <tr className="deal-total"><td>{t("results.totalCost")}</td><td>{aed(result.contract.totalCost)}</td></tr>
                    <tr><td>{t("results.grossProfitFromRental")}</td><td>{aed(result.contract.grossProfitFromRental)}</td></tr>
                    <tr className="deal-total deal-profit">
                      <td>{t("results.totalProfit")}</td>
                      <td className={result.contract.totalProfit < 0n ? "negative" : ""}>
                        {aed(result.contract.totalProfit)}
                      </td>
                    </tr>
                    <tr>
                      <td>{t("results.margin")}</td>
                      <td className={(result.contract.marginBasisPoints ?? 0) < 0 ? "negative" : ""}>
                        {result.contract.marginBasisPoints === null
                          ? t("results.noMargin")
                          : format.number(result.contract.marginBasisPoints / 10_000, {
                              style: "percent",
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                      </td>
                    </tr>
                  </tbody>
                </table>
                {result.contract.totalProfit < 0n ? (
                  <p className="field-error" style={{ marginBlockStart: 10 }}>{t("results.loss")}</p>
                ) : null}
              </section>

              <p className="muted" style={{ fontSize: 12.5 }}>{t("results.vatNote")}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
