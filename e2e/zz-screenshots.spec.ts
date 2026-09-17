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
    }

    await page.goto("/suppliers");
    await page.waitForSelector("h1");
    await page.screenshot({ path: `${SHOT_DIR}/suppliers-en.png`, fullPage: true });

    await page.goto("/notifications");
    await page.waitForSelector("h1");
    await page.screenshot({ path: `${SHOT_DIR}/notifications-en.png`, fullPage: true });

    try {
      // The signed-in user's language lives on their row, not in a cookie, so this
      // persists — and every other spec reads English labels.
      await page.locator('.language-option[lang="ar"]').click();
      await page.waitForSelector('html[dir="rtl"]');

      await page.goto("/customers");
      await page.waitForSelector("h1");
      await page.screenshot({ path: `${SHOT_DIR}/customers-ar.png`, fullPage: true });

      await page.goto("/suppliers");
      await page.waitForSelector("h1");
      await page.screenshot({ path: `${SHOT_DIR}/suppliers-ar.png`, fullPage: true });

      await page.goto("/notifications");
      await page.waitForSelector("h1");
      await page.screenshot({ path: `${SHOT_DIR}/notifications-ar.png`, fullPage: true });
    } finally {
      // Restore English whatever happened above, or the persona is left in Arabic and
      // the next run's specs fail looking for labels that are no longer there.
      await page.goto("/customers");
      await page.locator('.language-option[lang="en"]').click();
      await page.waitForSelector('html[dir="ltr"]');
    }
  });
});
