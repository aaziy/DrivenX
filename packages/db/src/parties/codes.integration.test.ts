/**
 * The property under test is uniqueness under concurrency, not the starting number.
 *
 * Sequences survive `TRUNCATE ... RESTART IDENTITY` — they are objects in their own right,
 * not table identity columns — so the value climbs across the suite. Asserting CUS-00001
 * would pass alone and fail in a full run, which is the least useful kind of test.
 */

import { describe, expect, it } from "vitest";

import { parsePartyCode } from "@drivenx/core";

import { nextCustomerCode, nextSupplierCode } from "./codes";

describe("party code allocation", () => {
  it("issues codes in the documented format", async () => {
    expect(await nextCustomerCode()).toMatch(/^CUS-\d{5,}$/);
    expect(await nextSupplierCode()).toMatch(/^SUP-\d{5,}$/);
  });

  it("never repeats a code, and moves forward", async () => {
    const first = parsePartyCode(await nextCustomerCode())!;
    const second = parsePartyCode(await nextCustomerCode())!;

    expect(second.sequence).toBeGreaterThan(first.sequence);
  });

  it("gives twenty simultaneous creates twenty different codes", async () => {
    // The whole reason this is a sequence. With MAX(code) + 1 these would collide, and
    // the failure would surface as a unique-constraint error in front of a customer.
    const codes = await Promise.all(Array.from({ length: 20 }, () => nextCustomerCode()));

    expect(new Set(codes).size).toBe(20);
  });

  it("counts customers and suppliers separately", async () => {
    // One shared counter would mean the first supplier is SUP-00007 because six customers
    // exist — which staff read as five missing suppliers.
    const customer = parsePartyCode(await nextCustomerCode())!;
    const supplier = parsePartyCode(await nextSupplierCode())!;

    await nextCustomerCode();
    await nextCustomerCode();

    const nextSupplier = parsePartyCode(await nextSupplierCode())!;

    expect(customer.kind).toBe("customer");
    expect(supplier.kind).toBe("supplier");
    // Three customers were drawn in between and the supplier counter did not move with them.
    expect(nextSupplier.sequence).toBe(supplier.sequence + 1);
  });
});
