import { describe, expect, it } from "vitest";

import {
  excessMileageCharge,
  formatFuelEighths,
  fuelShortfallEighths,
  isValidFuelEighths,
} from "./handover";

describe("the fuel gauge", () => {
  it("accepts a reading in eighths, empty to full", () => {
    for (let eighths = 0; eighths <= 8; eighths += 1) {
      expect(isValidFuelEighths(eighths)).toBe(true);
    }
  });

  it("refuses anything a gauge cannot show", () => {
    expect(isValidFuelEighths(-1)).toBe(false);
    expect(isValidFuelEighths(9)).toBe(false);
    expect(isValidFuelEighths(3.5)).toBe(false);
    expect(isValidFuelEighths(Number.NaN)).toBe(false);
  });

  it("reads as a fraction of a tank", () => {
    expect(formatFuelEighths(5)).toBe("5/8");
    expect(formatFuelEighths(0)).toBe("0/8");
  });

  it("reports fuel that came back short, and never a surplus", () => {
    expect(fuelShortfallEighths(8, 3)).toBe(5);
    expect(fuelShortfallEighths(4, 8)).toBe(0);
    expect(fuelShortfallEighths(4, 4)).toBe(0);
  });
});

describe("excess mileage at return", () => {
  it("charges the kilometres over the allowance at the contract's rate", () => {
    const result = excessMileageCharge({
      handoverKm: 12_000,
      returnKm: 74_500,
      allowanceKm: 60_000,
      rateFils: 50n, // AED 0.50/km
    });

    expect(result.travelledKm).toBe(62_500);
    expect(result.excessKm).toBe(2_500);
    expect(result.netFils).toBe(125_000n); // AED 1,250.00
    expect(result.chargeable).toBe(true);
  });

  it("charges nothing inside the allowance", () => {
    const result = excessMileageCharge({
      handoverKm: 12_000,
      returnKm: 50_000,
      allowanceKm: 60_000,
      rateFils: 50n,
    });

    expect(result.travelledKm).toBe(38_000);
    expect(result.excessKm).toBe(0);
    expect(result.netFils).toBe(0n);
    expect(result.chargeable).toBe(false);
  });

  it("charges nothing exactly on the allowance", () => {
    const result = excessMileageCharge({
      handoverKm: 0,
      returnKm: 60_000,
      allowanceKm: 60_000,
      rateFils: 50n,
    });

    expect(result.excessKm).toBe(0);
    expect(result.chargeable).toBe(false);
  });

  it("charges nothing on an unlimited-mileage contract", () => {
    const result = excessMileageCharge({
      handoverKm: 0,
      returnKm: 250_000,
      allowanceKm: null,
      rateFils: 50n,
    });

    expect(result.travelledKm).toBe(250_000);
    expect(result.excessKm).toBe(0);
    expect(result.netFils).toBe(0n);
    expect(result.chargeable).toBe(false);
  });

  it("charges nothing when no rate was ever agreed", () => {
    const result = excessMileageCharge({
      handoverKm: 0,
      returnKm: 250_000,
      allowanceKm: 60_000,
      rateFils: null,
    });

    expect(result.excessKm).toBe(0);
    expect(result.netFils).toBe(0n);
    expect(result.chargeable).toBe(false);
  });

  it("holds the line at one fils over, rather than rounding a small charge away", () => {
    const result = excessMileageCharge({
      handoverKm: 1_000,
      returnKm: 1_001,
      allowanceKm: 0,
      rateFils: 1n,
    });

    expect(result.excessKm).toBe(1);
    expect(result.netFils).toBe(1n);
    expect(result.chargeable).toBe(true);
  });

  it("reports no travel for a car that came back on the odometer it left on", () => {
    const result = excessMileageCharge({
      handoverKm: 12_000,
      returnKm: 12_000,
      allowanceKm: 1_000,
      rateFils: 50n,
    });

    expect(result.travelledKm).toBe(0);
    expect(result.chargeable).toBe(false);
  });
});
