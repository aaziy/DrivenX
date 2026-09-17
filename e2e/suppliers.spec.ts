import { expect, test } from "@playwright/test";

import { expectFormControlsConsistent, PERSONAS, signInExpectingSuccess } from "./helpers";

/**
 * Suppliers (P1A).
 *
 * The bank and tax details carry the weight here: a mistyped IBAN is a payment that fails
 * weeks later, and a wrong TRN makes every tax invoice to that supplier wrong. Both are
 * checked on the way in, so both are tested on the way in.
 */

// Published example values, valid by their own check digits.
const VALID_IBAN = "AE070331234567890123456";
const VALID_TRN = "100123456789012";

function uniqueCompany(): string {
  return `E2E Motors ${Date.now()}`;
}

test.describe("suppliers", () => {
  test("adds a supplier with bank details and finds them again", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await page.goto("/suppliers");

    const company = uniqueCompany();

    await page.getByLabel("Company name").fill(company);
    await page.getByLabel("Contact person").fill("Khalid Rahman");
    await page.getByLabel("Phone").fill("04 321 7654");
    await page.getByLabel("TRN").fill(VALID_TRN);
    await page.getByLabel("IBAN").fill(VALID_IBAN);

    await expectFormControlsConsistent(page, ".card form");

    await page.getByRole("button", { name: "Add supplier" }).click();
    await expect(page.locator(".alert-success")).toBeVisible();

    const row = page.locator(`tr:has-text("${company}")`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("SUP-");

    await page.getByLabel("Search").fill(company);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.locator(`tr:has-text("${company}")`)).toBeVisible();

    // By digits alone. This fails if the number is stored as typed, because the spaces
    // in "04 321 7654" sit between the digits being searched for.
    await page.getByLabel("Search").fill("3217654");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.locator(`tr:has-text("${company}")`)).toBeVisible();
  });

  test("refuses an IBAN that fails its check digits", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await page.goto("/suppliers");

    await page.getByLabel("Company name").fill(uniqueCompany());
    // One digit different from the valid example — exactly the kind of slip a person makes.
    await page.getByLabel("IBAN").fill("AE070331234567890123457");
    await page.getByRole("button", { name: "Add supplier" }).click();

    await expect(page.locator(".alert-error")).toBeVisible();
  });

  test("refuses a TRN that is not fifteen digits", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await page.goto("/suppliers");

    await page.getByLabel("Company name").fill(uniqueCompany());
    await page.getByLabel("TRN").fill("1001234567890");
    await page.getByRole("button", { name: "Add supplier" }).click();

    await expect(page.locator(".alert-error")).toBeVisible();
  });

  test("finance can see suppliers but not add one", async ({ page }) => {
    // Finance holds supplier.view for payables, deliberately not supplier.create.
    await signInExpectingSuccess(page, PERSONAS.finance);
    await page.goto("/suppliers");

    await expect(page.getByRole("heading", { name: "Suppliers" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Add supplier" })).toHaveCount(0);
  });
});
