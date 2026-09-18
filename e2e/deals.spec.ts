import { expect, test, type Page } from "@playwright/test";

import { PERSONAS, signInExpectingSuccess } from "./helpers";

/**
 * Deal calculator (P1C-04).
 *
 * The engine's arithmetic is proven in packages/core against both SOW examples. This
 * proves the screen shows those same figures when a salesperson types them in — the
 * failure it guards against is a form that parses, rounds or labels differently from the
 * engine it sits on.
 */

async function price(page: Page, figures: { rental: string; cost: string; months?: string; insurance?: string }) {
  await page.getByRole("radio", { name: "Leased from a supplier" }).check();
  await page.getByLabel("Term (months)").fill(figures.months ?? "36");
  await page.getByLabel("Monthly rental to the customer (AED)").fill(figures.rental);
  await page.getByLabel("Vehicle cost per month (AED)").fill(figures.cost);
  if (figures.insurance) {
    await page.getByLabel("Insurance charged per year (AED)").fill(figures.insurance);
  }
}

/** A row reads as its label followed by its amount. */
const row = (page: Page, text: string) => page.getByRole("row", { name: text, exact: true });

test.describe("deal calculator", () => {
  test.beforeEach(async ({ page }) => {
    // Sales holds deal.calculate — this is the first tool the role can actually use.
    await signInExpectingSuccess(page, PERSONAS.sales);
    await page.goto("/deals");
  });

  test("asks for the rental before showing a result", async ({ page }) => {
    // A table of zeros would read like an answer.
    await expect(page.getByText("Enter the monthly rental to see the deal.")).toBeVisible();
  });

  test("gives the SOW §8 figures: 1,100 a month and 39,600 over 36 months", async ({ page }) => {
    await price(page, { rental: "3,500", cost: "2,400" });

    await expect(row(page, "Gross profit AED 1,100.00")).toBeVisible();
    await expect(row(page, "Gross profit from rental AED 39,600.00")).toBeVisible();
    // VAT on top for the customer's quote: 3,500 + 5%.
    await expect(row(page, "Customer pays, VAT included AED 3,675.00")).toBeVisible();
  });

  test("gives the Key Financial Logic figures: 40,800 rental and 43,300 with insurance", async ({ page }) => {
    await price(page, { rental: "3400", cost: "2300", insurance: "2500" });

    await expect(row(page, "Revenue including insurance AED 43,300.00")).toBeVisible();
    await expect(page.getByRole("row", { name: "Rental AED 40,800.00", exact: true })).toBeVisible();
  });

  test("says plainly when a deal loses money", async ({ page }) => {
    await price(page, { rental: "2000", cost: "2400" });

    await expect(page.getByText("This deal loses money.")).toBeVisible();
    await expect(row(page, "Gross profit AED -400.00")).toBeVisible();
  });

  test("prices a car leased from a supplier only as lease-to-own", async ({ page }) => {
    await page.getByRole("radio", { name: "Leased from a supplier" }).check();

    await expect(page.getByRole("radio", { name: "Rental" })).toBeDisabled();
    await expect(page.getByRole("radio", { name: "Lease-to-own" })).toBeChecked();
    await expect(page.getByText("is priced as lease-to-own")).toBeVisible();
  });

  test("refuses an amount it cannot read", async ({ page }) => {
    await price(page, { rental: "3,50,0", cost: "2400" });
    await expect(page.getByText("Enter amounts in AED")).toBeVisible();
  });
});
