import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMINDER_OFFSETS,
  daysUntilExpiry,
  dueReminderOffsets,
  expiredDedupeKey,
  expiryStatus,
  reminderDedupeKey,
} from "./expiry";

const OFFSETS = [...DEFAULT_REMINDER_OFFSETS];

/** A fixed "now": 2026-09-17, mid-morning in Dubai. */
const NOW = new Date("2026-09-17T06:00:00Z");

/** An expiry `days` calendar days after NOW, at an awkward hour on purpose. */
function expiryIn(days: number): Date {
  return new Date(Date.UTC(2026, 8, 17 + days, 18, 42, 0));
}

describe("daysUntilExpiry", () => {
  it.each([
    [90, 90],
    [60, 60],
    [1, 1],
    [0, 0],
    [-1, -1],
  ])("is %i days away", (days, expected) => {
    expect(daysUntilExpiry(expiryIn(days), NOW)).toBe(expected);
  });

  it("does not depend on the time of day the job runs", () => {
    const expiry = expiryIn(30);
    const earlyMorning = new Date("2026-09-16T20:05:00Z"); // 00:05 Dubai on the 17th
    const lateEvening = new Date("2026-09-17T19:55:00Z"); // 23:55 Dubai on the 17th

    expect(daysUntilExpiry(expiry, earlyMorning)).toBe(30);
    expect(daysUntilExpiry(expiry, lateEvening)).toBe(30);
  });
});

describe("expiryStatus", () => {
  it("is no_expiry when the document never expires", () => {
    expect(expiryStatus(null, OFFSETS, NOW)).toBe("no_expiry");
  });

  it("is valid outside the widest reminder window", () => {
    expect(expiryStatus(expiryIn(61), OFFSETS, NOW)).toBe("valid");
  });

  it("becomes expiring exactly on the widest offset", () => {
    expect(expiryStatus(expiryIn(60), OFFSETS, NOW)).toBe("expiring");
  });

  it("is still expiring on the day of expiry, not expired", () => {
    // The licence is valid for the whole of its last day. Saying otherwise is how
    // people stop believing the alerts.
    expect(expiryStatus(expiryIn(0), OFFSETS, NOW)).toBe("expiring");
  });

  it("is expired the day after", () => {
    expect(expiryStatus(expiryIn(-1), OFFSETS, NOW)).toBe("expired");
  });

  it("treats a document with no reminders configured as valid until the day it expires", () => {
    expect(expiryStatus(expiryIn(5), [], NOW)).toBe("valid");
    expect(expiryStatus(expiryIn(0), [], NOW)).toBe("expiring");
  });
});

describe("dueReminderOffsets", () => {
  it("raises nothing before the first offset", () => {
    expect(dueReminderOffsets(expiryIn(61), OFFSETS, NOW)).toEqual([]);
  });

  it("raises the 60-day warning exactly on day 60", () => {
    expect(dueReminderOffsets(expiryIn(60), OFFSETS, NOW)).toEqual([60]);
  });

  it("includes offsets already passed, so an outage does not swallow warnings", () => {
    // Day 29: the 60 was raised a month ago and its dedupe key suppresses it. If the
    // job had been down, both would fire now, which is the behaviour we want.
    expect(dueReminderOffsets(expiryIn(29), OFFSETS, NOW)).toEqual([60, 30]);
  });

  it("has raised every warning by the day of expiry", () => {
    expect(dueReminderOffsets(expiryIn(0), OFFSETS, NOW)).toEqual([60, 30, 15, 7]);
  });

  it("stops once the document has expired", () => {
    expect(dueReminderOffsets(expiryIn(-1), OFFSETS, NOW)).toEqual([]);
  });

  it("raises nothing for a document with no expiry date", () => {
    expect(dueReminderOffsets(null, OFFSETS, NOW)).toEqual([]);
  });

  it("sorts and de-duplicates whatever offsets it is given", () => {
    expect(dueReminderOffsets(expiryIn(5), [7, 30, 7, 15], NOW)).toEqual([30, 15, 7]);
  });

  it("ignores nonsense offsets rather than raising nonsense warnings", () => {
    expect(dueReminderOffsets(expiryIn(5), [-3, 7.5, 15], NOW)).toEqual([15]);
  });

  it("supports a reminder on the expiry day itself", () => {
    expect(dueReminderOffsets(expiryIn(0), [0], NOW)).toEqual([0]);
    expect(dueReminderOffsets(expiryIn(1), [0], NOW)).toEqual([]);
  });
});

describe("dedupe keys", () => {
  it("are distinct per offset, so each warning fires once", () => {
    expect(reminderDedupeKey("doc_1", 30)).toBe("document:doc_1:reminder:30");
    expect(reminderDedupeKey("doc_1", 30)).toBe(reminderDedupeKey("doc_1", 30));
    expect(reminderDedupeKey("doc_1", 30)).not.toBe(reminderDedupeKey("doc_1", 15));
    expect(reminderDedupeKey("doc_1", 30)).not.toBe(reminderDedupeKey("doc_2", 30));
  });

  it("gives a renewed-then-lapsed document a fresh expiry alert", () => {
    const first = expiredDedupeKey("doc_1", new Date("2026-09-17T18:42:00Z"));
    const afterRenewal = expiredDedupeKey("doc_1", new Date("2027-09-17T18:42:00Z"));
    expect(first).not.toBe(afterRenewal);
  });

  it("keys the expiry alert by the Dubai date", () => {
    // 20:30 UTC is already the next day in Dubai; both must agree on which day expired.
    expect(expiredDedupeKey("doc_1", new Date("2026-09-17T20:30:00Z"))).toContain("2026-09-18");
  });
});
