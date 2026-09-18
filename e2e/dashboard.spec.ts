import { expect, test } from "@playwright/test";

import { PERSONAS, signInExpectingSuccess } from "./helpers";

/**
 * The dashboard (milestone 1E). The figures are proven against the ledger one layer down
 * (INV-6); this proves each role sees the blocks it may, and no more.
 */

test.describe("dashboard", () => {
  test("management sees the month's money, balances, fleet and the collections list", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await page.goto("/");

    for (const label of ["Revenue", "Cost", "Profit", "Customers owe", "Owed to suppliers", "Vehicles", "Active contracts"]) {
      await expect(page.locator(".stat-label", { hasText: new RegExp(`^${label}$`, "i") })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Overdue payments" })).toBeVisible();
  });

  test("sales sees the fleet and contracts, but not profit or what anyone owes", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.sales);
    await page.goto("/");

    await expect(page.locator(".stat-label", { hasText: /^Vehicles$/i })).toBeVisible();
    await expect(page.locator(".stat-label", { hasText: /^Profit$/i })).toHaveCount(0);
    await expect(page.locator(".stat-label", { hasText: /^Customers owe$/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Overdue payments" })).toHaveCount(0);
  });
});
