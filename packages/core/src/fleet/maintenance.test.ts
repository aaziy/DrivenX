import { describe, expect, it } from "vitest";

import { serviceDue, SERVICE_KM_WARNING } from "./maintenance";

const at = { today: "2026-06-01", odometerKm: 40_000 };

describe("serviceDue", () => {
  it("says nothing when the garage set no markers", () => {
    expect(serviceDue({ nextServiceOn: null, nextServiceKm: null }, at)).toEqual({
      overdue: false,
      dueSoon: false,
      daysRemaining: null,
      kmRemaining: null,
    });
  });

  it("warns a fortnight before the date, and calls it overdue the day after", () => {
    expect(serviceDue({ nextServiceOn: "2026-06-20", nextServiceKm: null }, at).dueSoon).toBe(false);
    expect(serviceDue({ nextServiceOn: "2026-06-15", nextServiceKm: null }, at)).toMatchObject({
      dueSoon: true,
      overdue: false,
      daysRemaining: 14,
    });
    expect(serviceDue({ nextServiceOn: "2026-06-01", nextServiceKm: null }, at)).toMatchObject({
      dueSoon: true,
      overdue: false,
    });
    expect(serviceDue({ nextServiceOn: "2026-05-31", nextServiceKm: null }, at)).toMatchObject({
      overdue: true,
      daysRemaining: -1,
    });
  });

  it("warns within 500 km, and calls it overdue once passed", () => {
    expect(serviceDue({ nextServiceOn: null, nextServiceKm: 45_000 }, at).dueSoon).toBe(false);
    expect(serviceDue({ nextServiceOn: null, nextServiceKm: 40_000 + SERVICE_KM_WARNING }, at)).toMatchObject({
      dueSoon: true,
      kmRemaining: 500,
    });
    expect(serviceDue({ nextServiceOn: null, nextServiceKm: 39_900 }, at)).toMatchObject({
      overdue: true,
      kmRemaining: -100,
    });
  });

  it("takes whichever marker arrives first, and overdue outranks due soon", () => {
    // Date comfortable, distance already passed.
    expect(serviceDue({ nextServiceOn: "2026-12-01", nextServiceKm: 39_000 }, at)).toMatchObject({
      overdue: true,
      dueSoon: false,
    });
    // Distance comfortable, date near.
    expect(serviceDue({ nextServiceOn: "2026-06-10", nextServiceKm: 60_000 }, at)).toMatchObject({
      overdue: false,
      dueSoon: true,
    });
  });
});
