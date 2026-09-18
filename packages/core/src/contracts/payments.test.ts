import { describe, expect, it } from "vitest";

import { parse } from "../money/money";
import {
  allocatePayment,
  installmentStatus,
  InvalidPaymentError,
  outstandingFils,
  type OpenInstallment,
} from "./payments";

const aed = (value: string) => parse(value);

function owed(id: string, dueDate: string, gross = "3570", paid = "0", waived = false): OpenInstallment {
  return { id, dueDate, sequence: Number(id.replace(/\D/g, "")) || 1, grossFils: aed(gross), paidFils: aed(paid), waived };
}

describe("allocatePayment", () => {
  it("settles the oldest instalment first", () => {
    const result = allocatePayment(aed("3570"), [owed("i2", "2026-02-01"), owed("i1", "2026-01-01")]);
    expect(result.allocations).toEqual([{ installmentId: "i1", amountFils: aed("3570") }]);
    expect(result.creditFils).toBe(0n);
  });

  it("carries a partial payment into the next instalment", () => {
    const result = allocatePayment(aed("5000"), [owed("i1", "2026-01-01"), owed("i2", "2026-02-01")]);
    expect(result.allocations).toEqual([
      { installmentId: "i1", amountFils: aed("3570") },
      { installmentId: "i2", amountFils: aed("1430") },
    ]);
  });

  it("pays off only what is still owed on a part-paid instalment", () => {
    const result = allocatePayment(aed("3000"), [owed("i1", "2026-01-01", "3570", "1000"), owed("i2", "2026-02-01")]);
    expect(result.allocations).toEqual([
      { installmentId: "i1", amountFils: aed("2570") },
      { installmentId: "i2", amountFils: aed("430") },
    ]);
  });

  it("keeps an over-payment as credit rather than dropping it", () => {
    const result = allocatePayment(aed("10000"), [owed("i1", "2026-01-01"), owed("i2", "2026-02-01")]);
    expect(result.creditFils).toBe(aed("2860"));
  });

  it("passes over waived and settled instalments", () => {
    const result = allocatePayment(aed("3570"), [
      owed("i1", "2026-01-01", "3570", "3570"),
      owed("i2", "2026-02-01", "3570", "0", true),
      owed("i3", "2026-03-01"),
    ]);
    expect(result.allocations).toEqual([{ installmentId: "i3", amountFils: aed("3570") }]);
  });

  it.each(["0", "-1"])("refuses a payment of %s", (amount) => {
    expect(() => allocatePayment(aed(amount), [owed("i1", "2026-01-01")])).toThrow(InvalidPaymentError);
  });

  it("allocates plus credit is always exactly the payment, and never overpays an instalment (INV-2, INV-3)", () => {
    let seed = 918;
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648);

    for (let run = 0; run < 400; run += 1) {
      const installments = Array.from({ length: 1 + (next() % 8) }, (_, i) =>
        owed(`i${i + 1}`, `2026-${String(1 + (next() % 12)).padStart(2, "0")}-01`, "3570", String(next() % 3570), next() % 7 === 0),
      );
      const amount = BigInt(1 + (next() % 3_000_000));
      const result = allocatePayment(amount, installments);

      const allocated = result.allocations.reduce((sum, a) => sum + a.amountFils, 0n);
      expect(allocated + result.creditFils).toBe(amount);

      for (const allocation of result.allocations) {
        const target = installments.find((item) => item.id === allocation.installmentId)!;
        expect(allocation.amountFils).toBeGreaterThan(0n);
        expect(allocation.amountFils).toBeLessThanOrEqual(target.grossFils - target.paidFils);
        expect(target.waived).toBe(false);
      }
    }
  });
});

describe("installmentStatus", () => {
  const today = "2026-03-15";
  const state = (dueDate: string, paid = "0", waived = false) => ({
    dueDate,
    grossFils: aed("3570"),
    paidFils: aed(paid),
    waived,
  });

  it.each([
    ["not yet due", state("2026-04-01"), "UPCOMING"],
    ["due today", state("2026-03-15"), "DUE"],
    ["past due and unpaid", state("2026-03-01"), "OVERDUE"],
    ["part paid and not yet due", state("2026-04-01", "1000"), "PARTIALLY_PAID"],
    ["part paid and late — still late", state("2026-03-01", "1000"), "OVERDUE"],
    ["paid in full, even if late", state("2026-01-01", "3570"), "PAID"],
    ["waived", state("2026-01-01", "0", true), "WAIVED"],
  ] as const)("%s → %s", (_label, input, expected) => {
    expect(installmentStatus(input, today)).toBe(expected);
  });
});

describe("outstandingFils", () => {
  it("sums what is still owed, leaving out waived instalments", () => {
    expect(
      outstandingFils([
        owed("i1", "2026-01-01", "3570", "1000"),
        owed("i2", "2026-02-01"),
        owed("i3", "2026-03-01", "3570", "0", true),
      ]),
    ).toBe(aed("6140"));
  });
});
