import { expect, test } from "@playwright/test";

import {
  expectFormControlsConsistent,
  PERSONAS,
  signInExpectingSuccess,
} from "./helpers";

/**
 * Customers (P1A). One journey, end to end — the wiring, not the logic.
 *
 * The mobile number is typed the way staff type it and asserted in the form it is stored
 * in, because normalisation is the part that silently turns one person into three.
 */

function uniqueName(): string {
  return `E2E Customer ${Date.now()}`;
}

test.describe("customers", () => {
  test("adds a customer, finds them by search, and edits them", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await page.goto("/customers");

    const name = uniqueName();

    await page.getByLabel("Full name").fill(name);
    // Not `exact`: the required marker lives inside the label, so its text is "Mobile *".
    // Typed the way it is typed on the phone: spaces, local leading zero.
    await page.getByLabel("Mobile").fill("050 123 4567");
    await page.getByLabel("Email").fill(`e2e.${Date.now()}@example.com`);
    await page.getByLabel("Nationality").fill("Emirati");

    // The stylesheet only styles the input types it names; tel and date fields were
    // unstyled once already.
    await expectFormControlsConsistent(page, ".card form");

    await page.getByRole("button", { name: "Add customer" }).click();
    await expect(page.locator(".alert-success")).toBeVisible();

    // Stored normalised, whatever was typed.
    const row = page.locator(`tr:has-text("${name}")`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("+971501234567");
    await expect(row).toContainText("CUS-");

    // Search finds them by name.
    await page.getByLabel("Search").fill(name);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.locator(`tr:has-text("${name}")`)).toBeVisible();

    // And the code is a link through to the record.
    await page.locator(`tr:has-text("${name}") a`).first().click();
    await expect(page.getByRole("heading", { name })).toBeVisible();

    await page.getByLabel("City").fill("Dubai");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator(".alert-success")).toBeVisible();
    await expect(page.getByLabel("City")).toHaveValue("Dubai");
  });

  test("rejects a mobile number that is not a UAE mobile", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await page.goto("/customers");

    await page.getByLabel("Full name").fill(uniqueName());
    // 51 is not an operator prefix in use.
    await page.getByLabel("Mobile").fill("0511234567");
    await page.getByRole("button", { name: "Add customer" }).click();

    await expect(page.locator(".alert-error")).toBeVisible();
  });

  test("sales staff can add a customer but cannot remove one", async ({ page }) => {
    // Sales holds customer.create and customer.update, deliberately not customer.delete.
    await signInExpectingSuccess(page, PERSONAS.sales);
    await page.goto("/customers");

    // Creates its own record rather than clicking whatever an earlier test left behind:
    // a spec that depends on another spec's leftovers fails for reasons that are not
    // about the thing it is testing.
    const name = uniqueName();
    await page.getByLabel("Full name").fill(name);
    await page.getByLabel("Mobile").fill("055 987 6543");
    await page.getByRole("button", { name: "Add customer" }).click();
    await expect(page.locator(".alert-success")).toBeVisible();

    await page.locator(`tr:has-text("${name}") a`).first().click();

    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove customer" })).toHaveCount(0);
  });
});
