import { expect, test, type Page } from "@playwright/test";

import { PERSONAS, signInExpectingSuccess, signOut } from "./helpers";

/**
 * Global search (P1A-09, SOW §16).
 *
 * Proves the wiring: the box in the sidebar reaches the ranked query and the result
 * leads back to the record. The matching itself — misspellings, mobile formats, document
 * numbers — is tested against Postgres in packages/db, where a failure names the query
 * rather than the page.
 */

async function searchFor(page: Page, query: string): Promise<void> {
  await page.getByLabel("Search everything").fill(query);
  await page.getByLabel("Search everything").press("Enter");
  await page.waitForURL(/\/search\?/);
}

async function createCustomer(page: Page, name: string, mobile: string): Promise<void> {
  await page.goto("/customers");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile").fill(mobile);
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.locator(".alert-success")).toBeVisible();
}

test.describe("global search", () => {
  test("finds a customer from the sidebar and opens their record", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);

    const name = `E2E Findable ${Date.now()}`;
    await createCustomer(page, name, "055 222 1144");

    await searchFor(page, name);

    const row = page.locator("tr", { hasText: name }).first();
    await expect(row).toBeVisible();

    await row.getByRole("link", { name: "Open" }).click();
    await page.waitForURL(/\/customers\/.+/);
    await expect(page.getByRole("heading", { name })).toBeVisible();
  });

  test("finds a customer from a mobile number typed the way it is spoken", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);

    const name = `E2E Mobile ${Date.now()}`;
    // Stored as +971544455566; searched for the way somebody reads it off a phone.
    await createCustomer(page, name, "054 445 5566");

    await searchFor(page, "054 445 5566");

    await expect(page.locator("tr", { hasText: name }).first()).toBeVisible();
  });

  test("shows a person only what their role can reach", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);

    const company = `E2E Hidden Motors ${Date.now()}`;
    await page.goto("/suppliers");
    await page.getByLabel("Company name").fill(company);
    await page.getByRole("button", { name: "Add supplier" }).click();
    await expect(page.locator(".alert-success")).toBeVisible();

    // Sales holds customer.view and document.view, deliberately not supplier.view.
    // Search must not become the way round a permission boundary.
    await signOut(page);
    await signInExpectingSuccess(page, PERSONAS.sales);

    await searchFor(page, company);

    await expect(page.locator("tr", { hasText: company })).toHaveCount(0);
  });
});
