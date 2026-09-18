import { describe, expect, it } from "vitest";

import { parse } from "../money/money";
import { InvalidPaymentError } from "./payments";
import {
  assertSupplierPayment,
  supplierInvoiceStatus,
  supplierSchedule,
  SupplierOverpaymentError,
} from "./supplier";

const aed = (value: string) => parse(value);

describe("supplierSchedule", () => {
  it("bills one invoice per contract month over the customer's periods", () => {
    const schedule = supplierSchedule("2026-01-31", 3, aed("2500"));
    expect(schedule).toEqual([
      { sequence: 1, periodStart: "2026-01-31", periodEnd: "2026-02-27", dueDate: "2026-01-31", amountFils: aed("2500") },
      { sequence: 2, periodStart: "2026-02-28", periodEnd: "2026-03-30", dueDate: "2026-02-28", amountFils: aed("2500") },
      { sequence: 3, periodStart: "2026-03-31", periodEnd: "2026-04-29", dueDate: "2026-03-31", amountFils: aed("2500") },
    ]);
  });

  it("refuses a schedule with no months or no cost", () => {
    expect(() => supplierSchedule("2026-01-01", 0, aed("2500"))).toThrow(RangeError);
    expect(() => supplierSchedule("2026-01-01", 12, 0n)).toThrow(RangeError);
  });
});

describe("supplierInvoiceStatus", () => {
  const invoice = { amountFils: aed("2500"), paidFils: 0n, dueDate: "2026-03-01" };

  it("follows the same calendar as a customer instalment", () => {
    expect(supplierInvoiceStatus(invoice, "2026-02-28")).toBe("UPCOMING");
    expect(supplierInvoiceStatus(invoice, "2026-03-01")).toBe("DUE");
    expect(supplierInvoiceStatus(invoice, "2026-03-02")).toBe("OVERDUE");
    expect(supplierInvoiceStatus({ ...invoice, paidFils: aed("1000") }, "2026-03-01")).toBe("PARTIALLY_PAID");
    expect(supplierInvoiceStatus({ ...invoice, paidFils: aed("2500") }, "2026-04-01")).toBe("PAID");
  });
});

describe("assertSupplierPayment", () => {
  it("accepts up to what is left", () => {
    expect(() => assertSupplierPayment(aed("2500"), aed("2500"))).not.toThrow();
  });

  it("refuses nothing, and refuses paying more than was billed", () => {
    expect(() => assertSupplierPayment(0n, aed("2500"))).toThrow(InvalidPaymentError);
    expect(() => assertSupplierPayment(aed("2500.01"), aed("2500"))).toThrow(SupplierOverpaymentError);
  });
});
