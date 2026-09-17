import { describe, expect, it } from "vitest";

import {
  BUSINESS_UTC_OFFSET_HOURS,
  businessDate,
  businessDaysBetween,
  startOfBusinessDay,
} from "./time";

describe("businessDate", () => {
  it("reads the date as Dubai reads it, not as UTC does", () => {
    // 20:30 UTC is already the next morning in Dubai. Using the UTC date here would
    // date a document, a payment or a reminder to the wrong day every evening.
    expect(businessDate(new Date("2026-09-01T20:30:00Z"))).toBe("2026-09-02");
    expect(businessDate(new Date("2026-09-01T19:59:00Z"))).toBe("2026-09-01");
  });

  it("handles the year boundary", () => {
    expect(businessDate(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
  });
});

describe("startOfBusinessDay", () => {
  it("returns Dubai midnight, which is 20:00 UTC the day before", () => {
    expect(startOfBusinessDay(new Date("2026-09-02T09:00:00Z")).toISOString()).toBe(
      "2026-09-01T20:00:00.000Z",
    );
  });

  it("is stable for every instant within the same Dubai day", () => {
    const morning = startOfBusinessDay(new Date("2026-09-01T20:00:00Z"));
    const evening = startOfBusinessDay(new Date("2026-09-02T19:59:59Z"));
    expect(morning.toISOString()).toBe(evening.toISOString());
  });
});

describe("businessDaysBetween", () => {
  it("counts whole calendar days", () => {
    expect(
      businessDaysBetween(new Date("2026-09-01T08:00:00Z"), new Date("2026-10-01T08:00:00Z")),
    ).toBe(30);
  });

  it("ignores the time of day at both ends", () => {
    // The nightly job must give the same answer whenever it happens to run.
    const expiry = new Date("2026-10-01T00:00:00Z");
    const justAfterMidnightDubai = new Date("2026-09-01T20:05:00Z");
    const lateEveningDubai = new Date("2026-09-02T19:55:00Z");

    expect(businessDaysBetween(justAfterMidnightDubai, expiry)).toBe(
      businessDaysBetween(lateEveningDubai, expiry),
    );
  });

  it("is zero on the day itself and negative afterwards", () => {
    const now = new Date("2026-09-17T06:00:00Z"); // 10:00 Dubai on the 17th
    expect(businessDaysBetween(now, new Date("2026-09-17T19:00:00Z"))).toBe(0); // 23:00 Dubai, same day
    expect(businessDaysBetween(now, new Date("2026-09-16T06:00:00Z"))).toBe(-1);
  });

  it("counts a late-evening UTC instant as the next day, because Dubai already has", () => {
    // 22:00 UTC is 02:00 tomorrow in Dubai. Reading this as "the same day" is the
    // mistake this module exists to prevent — it would date reminders, invoices and
    // payments to the wrong day every evening.
    const now = new Date("2026-09-17T06:00:00Z");
    expect(businessDaysBetween(now, new Date("2026-09-17T22:00:00Z"))).toBe(1);
  });

  it("crosses a leap day correctly", () => {
    expect(
      businessDaysBetween(new Date("2028-02-28T08:00:00Z"), new Date("2028-03-01T08:00:00Z")),
    ).toBe(2);
  });

  it("crosses a month and a year boundary", () => {
    expect(
      businessDaysBetween(new Date("2026-12-31T08:00:00Z"), new Date("2027-01-01T08:00:00Z")),
    ).toBe(1);
  });

  it("assumes a fixed offset, which only holds where there is no daylight saving", () => {
    expect(BUSINESS_UTC_OFFSET_HOURS).toBe(4);
  });
});
