import { test } from "@playwright/test";

import { PERSONAS, signInExpectingSuccess } from "./helpers";

/**
 * Capture the new pages so they can actually be looked at.
 *
 * Not an assertion — a developer aid. Milestone 0 shipped a permission editor that was
 * invisible on screen while every test passed, and it was found by looking at a picture.
 *
 * Runs only when SHOT_DIR is set, and named `zz-` so it runs after the specs that create
 * the records it photographs.
 */

const SHOT_DIR = process.env["SHOT_DIR"] ?? "";

test.describe("screenshots", () => {
  test.skip(!SHOT_DIR, "SHOT_DIR is not set");

  test("captures customers and suppliers in both languages", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.superAdmin);

    // Waits on the page itself, not on a table: with no records the list renders an
    // empty state and there is no table to wait for. This spec photographs whatever is
    // there rather than depending on what another spec happened to leave behind.
    await page.goto("/");
    await page.waitForSelector("h1");
    await page.screenshot({ path: `${SHOT_DIR}/dashboard-en.png`, fullPage: true });

    await page.goto("/reports/profitability?view=vehicle&from=2026-01&to=2026-12");
    await page.waitForSelector("h1");
    await page.screenshot({ path: `${SHOT_DIR}/profitability-en.png`, fullPage: true });

    await page.goto("/customers");
    await page.waitForSelector("h1");
    await page.screenshot({ path: `${SHOT_DIR}/customers-en.png`, fullPage: true });

    const firstCustomer = page.locator("tbody tr a").first();
    if (await firstCustomer.count()) {
      await firstCustomer.click();
      // Waits for the URL, not for an h1: both pages have one, so waiting on the element
      // returns immediately and photographs the list again.
      await page.waitForURL(/\/customers\/.+/);
      await page.screenshot({ path: `${SHOT_DIR}/customer-detail-en.png`, fullPage: true });
      await page.goto(`${page.url()}/statement?from=2026-01-01`);
      await page.waitForSelector("h1");
      await page.screenshot({ path: `${SHOT_DIR}/statement-en.png`, fullPage: true });
    }

    await page.goto("/suppliers");
    await page.waitForSelector("h1");
    await page.screenshot({ path: `${SHOT_DIR}/suppliers-en.png`, fullPage: true });

    await page.goto("/notifications");
    await page.waitForSelector("h1");
    await page.screenshot({ path: `${SHOT_DIR}/notifications-en.png`, fullPage: true });

    // "E2E" matches the records the other specs leave behind, so the page has results.
    await page.goto("/search?q=E2E");
    await page.waitForSelector("h1");
    await page.screenshot({ path: `${SHOT_DIR}/search-en.png`, fullPage: true });

    await page.goto("/admin/document-categories");
    await page.waitForSelector("h1");
    await page.screenshot({ path: `${SHOT_DIR}/document-types-en.png`, fullPage: true });

    await page.goto("/contracts");
    await page.waitForSelector("h1");
    await page.screenshot({ path: `${SHOT_DIR}/contracts-en.png`, fullPage: true });
    const firstContract = page.locator("tbody tr a").first();
    if (await firstContract.count()) {
      await firstContract.click();
      await page.waitForURL(/\/contracts\/(?!new)[^/]+$/);
      await page.screenshot({ path: `${SHOT_DIR}/contract-detail-en.png`, fullPage: true });
    }

    // A lease-to-own contract, which on a leased-in car also carries the supplier's invoices.
    await page.goto("/contracts");
    const leaseToOwn = page.locator("tbody tr", { hasText: "Lease-to-own" }).locator("a").first();
    if (await leaseToOwn.count()) {
      await leaseToOwn.click();
      await page.waitForURL(/\/contracts\/(?!new)[^/]+$/);
      await page.screenshot({ path: `${SHOT_DIR}/contract-lto-en.png`, fullPage: true });
    }

    await page.goto("/deals");
    await page.waitForSelector("h1");
    await page.getByLabel("Monthly rental to the customer (AED)").fill("3500");
    await page.getByLabel("Vehicle cost per month (AED)").fill("2400");
    await page.getByLabel("Insurance charged per year (AED)").fill("2500");
    await page.screenshot({ path: `${SHOT_DIR}/deals-en.png`, fullPage: true });

    await page.goto("/vehicles");
    await page.waitForSelector("h1");
    await page.screenshot({ path: `${SHOT_DIR}/vehicles-en.png`, fullPage: true });

    await page.goto("/vehicles/new");
    await page.waitForSelector("h1");
    await page.screenshot({ path: `${SHOT_DIR}/vehicle-new-en.png`, fullPage: true });

    await page.goto("/vehicles");
    const firstVehicle = page.locator("tbody tr a").first();
    if (await firstVehicle.count()) {
      await firstVehicle.click();
      await page.waitForURL(/\/vehicles\/(?!new)[^/]+$/);
      await page.screenshot({ path: `${SHOT_DIR}/vehicle-detail-en.png`, fullPage: true });
    }

    try {
      // The signed-in user's language lives on their row, not in a cookie, so this
      // persists — and every other spec reads English labels.
      await page.locator('.language-option[lang="ar"]').click();
      await page.waitForSelector('html[dir="rtl"]');

      await page.goto("/");
      await page.waitForSelector("h1");
      await page.screenshot({ path: `${SHOT_DIR}/dashboard-ar.png`, fullPage: true });

      await page.goto("/reports/profitability?view=vehicle&from=2026-01&to=2026-12");
      await page.waitForSelector("h1");
      await page.screenshot({ path: `${SHOT_DIR}/profitability-ar.png`, fullPage: true });

      await page.goto("/customers");
      await page.waitForSelector("h1");
      await page.screenshot({ path: `${SHOT_DIR}/customers-ar.png`, fullPage: true });
      const customerAr = page.locator("tbody tr a").first();
      if (await customerAr.count()) {
        await customerAr.click();
        await page.waitForURL(/\/customers\/.+/);
        await page.goto(`${page.url()}/statement?from=2026-01-01`);
        await page.waitForSelector("h1");
        await page.screenshot({ path: `${SHOT_DIR}/statement-ar.png`, fullPage: true });
      }

      await page.goto("/suppliers");
      await page.waitForSelector("h1");
      await page.screenshot({ path: `${SHOT_DIR}/suppliers-ar.png`, fullPage: true });

      await page.goto("/notifications");
      await page.waitForSelector("h1");
      await page.screenshot({ path: `${SHOT_DIR}/notifications-ar.png`, fullPage: true });

      await page.goto("/search?q=E2E");
      await page.waitForSelector("h1");
      await page.screenshot({ path: `${SHOT_DIR}/search-ar.png`, fullPage: true });

      await page.goto("/admin/document-categories");
      await page.waitForSelector("h1");
      await page.screenshot({ path: `${SHOT_DIR}/document-types-ar.png`, fullPage: true });

      await page.goto("/contracts");
      await page.waitForSelector("h1");
      const firstContract = page.locator("tbody tr a").first();
      if (await firstContract.count()) {
        await firstContract.click();
        await page.waitForURL(/\/contracts\/(?!new)[^/]+$/);
        await page.screenshot({ path: `${SHOT_DIR}/contract-detail-ar.png`, fullPage: true });
      }

      await page.goto("/contracts");
      const leaseToOwn = page.locator("tbody tr", { hasText: "إيجار منتهٍ بالتملك" }).locator("a").first();
      if (await leaseToOwn.count()) {
        await leaseToOwn.click();
        await page.waitForURL(/\/contracts\/(?!new)[^/]+$/);
        await page.screenshot({ path: `${SHOT_DIR}/contract-lto-ar.png`, fullPage: true });
      }

      await page.goto("/deals");
      await page.waitForSelector("h1");
      await page.locator("#rental").fill("3500");
      await page.locator("#vehicleMonthlyCost").fill("2400");
      await page.screenshot({ path: `${SHOT_DIR}/deals-ar.png`, fullPage: true });

      await page.goto("/vehicles");
      await page.waitForSelector("h1");
      await page.screenshot({ path: `${SHOT_DIR}/vehicles-ar.png`, fullPage: true });

      const firstVehicle = page.locator("tbody tr a").first();
      if (await firstVehicle.count()) {
        await firstVehicle.click();
        await page.waitForURL(/\/vehicles\/(?!new)[^/]+$/);
        await page.screenshot({ path: `${SHOT_DIR}/vehicle-detail-ar.png`, fullPage: true });
      }
    } finally {
      // Restore English whatever happened above, or the persona is left in Arabic and
      // the next run's specs fail looking for labels that are no longer there.
      await page.goto("/customers");
      await page.locator('.language-option[lang="en"]').click();
      await page.waitForSelector('html[dir="ltr"]');
    }
  });
});
