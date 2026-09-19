import { readFileSync } from "node:fs";

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

  test("exports what is on screen to Excel", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await page.goto("/reports/profitability?view=month&from=2026-01&to=2026-12");
    const link = page.getByRole("link", { name: "Export to Excel" });
    if ((await link.count()) === 0) test.skip(true, "nothing booked in 2026 in this database");

    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    expect(download.suggestedFilename()).toBe("profitability-month-2026-01-to-2026-12.xlsx");
    const path = await download.path();
    const bytes = readFileSync(path);
    // An .xlsx is a zip archive.
    expect(bytes.subarray(0, 2).toString()).toBe("PK");

    const [pdf] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Export to PDF" }).click(),
    ]);
    expect(pdf.suggestedFilename()).toBe("profitability-month-2026-01-to-2026-12.pdf");
    expect(readFileSync(await pdf.path()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("filters by contract type and carries the filter into its exports", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await page.goto("/reports/profitability?view=contract&from=2026-01&to=2026-12");
    await page.getByLabel("Contract type").selectOption({ label: "Lease-to-own" });
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page).toHaveURL(/type=LEASE_TO_OWN/);

    const excel = page.getByRole("link", { name: "Export to Excel" });
    if (await excel.count()) await expect(excel).toHaveAttribute("href", /type=LEASE_TO_OWN/);
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
    expect((await page.request.get("/reports/profitability/export?view=vehicle")).status()).toBe(403);
  });
});
