import { expect, test } from "@playwright/test";

import { PERSONAS, signInExpectingSuccess } from "./helpers";

/**
 * Profitability (milestone 1E). That every view adds up to the ledger is proven one layer
 * down; this proves the screen offers each view, closes with a total, and is shown only
 * to those allowed the financial reports.
 */

test.describe("profitability report", () => {
  test("offers every view, each closing with a total", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await page.getByRole("link", { name: "Profitability" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Profitability" })).toBeVisible();

    for (const view of ["Vehicle", "Customer", "Supplier", "Contract", "Month"]) {
      await page.getByLabel("View by").selectOption({ label: view });
      await page.getByRole("button", { name: "Show" }).click();
      await expect(page).toHaveURL(new RegExp(`view=${view.toLowerCase()}`));
      // A month with nothing booked shows the empty state; otherwise the table has a total.
      const table = page.getByRole("table", { name: "Profitability" });
      if (await table.count()) {
        await expect(table.locator("thead")).toContainText(view);
        await expect(table.locator("tfoot")).toContainText("Total");
      } else {
        await expect(page.getByText("Nothing was booked in these months.")).toBeVisible();
      }
    }
  });

  test("refuses a range that runs backwards", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await page.goto("/reports/profitability?view=month&from=2026-06&to=2026-01");
    await expect(page.getByText("The start month must come before the end month.")).toBeVisible();
  });

  test("is not offered to sales, and refused if reached directly", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.sales);
    await expect(page.getByRole("link", { name: "Profitability" })).toHaveCount(0);
    await page.goto("/reports/profitability");
    await expect(page.getByRole("heading", { name: "Not permitted" })).toBeVisible();
  });
});
