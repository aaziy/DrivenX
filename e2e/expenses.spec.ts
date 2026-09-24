import { expect, test } from "@playwright/test";

import { PERSONAS, signInExpectingSuccess } from "./helpers";

/**
 * Expenses (P2-11, SOW §13), through the screens.
 *
 * The rule the journey proves is the one that keeps per-vehicle profitability honest: an
 * overhead belongs to the company and to no car, and the form does not even offer a car
 * to charge it to.
 */

/** Descriptions are stamped: these rows outlive the run, and a repeated run would
 *  otherwise match two identical rows and fail on the second. */
const stamp = () => `${Date.now()}`.slice(-8);

test.describe("expenses", () => {
  test("a company overhead is charged to nobody's car", async ({ page }) => {
    const what = `Office rent ${stamp()}`;
    await signInExpectingSuccess(page, PERSONAS.management);
    await page.goto("/expenses");

    await page.getByRole("combobox", { name: "Kind", exact: true }).selectOption("OVERHEAD");
    await page.getByRole("combobox", { name: "Charged to", exact: true }).selectOption("COMPANY");

    // No car to choose: the allocation decides, and the form does not offer what would
    // put office rent onto a vehicle's profitability.
    await expect(page.getByRole("combobox", { name: "Car", exact: true })).toHaveCount(0);

    await page.getByRole("textbox", { name: "Amount (AED)" }).fill("12,000");
    await page.getByLabel("What it was for").fill(what);
    await page.getByRole("button", { name: "Record expense" }).click();
    await expect(page.getByText("Expense recorded.")).toBeVisible();

    await expect(page.getByRole("row", { name: what })).toContainText("The company");
    // This row, not the category's running total: the breakdown accumulates across runs,
    // and an aggregate is not a fact about this test.
    await expect(page.getByRole("row", { name: what })).toContainText("12,000.00");
    await expect(page.locator("tr", { hasText: "Company overhead" }).first()).toBeVisible();
  });

  test("a government charge carries no VAT, and fuel does", async ({ page }) => {
    const what = `Diesel for the yard van ${stamp()}`;
    await signInExpectingSuccess(page, PERSONAS.management);
    await page.goto("/expenses");

    // Registration: nothing to reclaim, so the form defaults to none.
    await page.getByRole("combobox", { name: "Kind", exact: true }).selectOption("REGISTRATION");
    await expect(page.getByRole("combobox", { name: "VAT", exact: true })).toHaveValue("0");

    // Fuel is an ordinary supply, and the box follows the kind rather than what was
    // chosen a moment ago.
    await page.getByRole("combobox", { name: "Kind", exact: true }).selectOption("FUEL");
    await expect(page.getByRole("combobox", { name: "VAT", exact: true })).toHaveValue("500");

    await page.getByRole("combobox", { name: "Charged to", exact: true }).selectOption("COMPANY");
    await page.getByRole("textbox", { name: "Amount (AED)" }).fill("200");
    await page.getByLabel("What it was for").fill(what);
    await page.getByRole("button", { name: "Record expense" }).click();
    await expect(page.getByText("Expense recorded.")).toBeVisible();

    // 200 net, 10 of VAT — and the breakdown counts the net, not the 210 paid.
    const row = page.getByRole("row", { name: what });
    await expect(row).toContainText("200.00");
    await expect(row).toContainText("10.00");
  });
});
