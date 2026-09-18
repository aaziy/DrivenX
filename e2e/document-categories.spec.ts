import { expect, test } from "@playwright/test";

import { PERSONAS, signInExpectingSuccess } from "./helpers";

/**
 * Document type administration (P1A-04, SOW §17).
 *
 * The client configures these without a release, so the two rules that matter are: a
 * seeded type can be reworded and rescheduled but never removed, and one they added
 * themselves is entirely theirs.
 *
 * Deliberately operates on its own category rather than editing a seeded one. Other
 * specs depend on the seeded schedules, and a spec that quietly changes shared fixture
 * data fails a different spec later, which is a miserable thing to track down.
 */
test.describe("document types", () => {
  test("a built-in type can be reworded but not removed", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.superAdmin);
    await page.goto("/admin/document-categories");

    const row = page.locator("tr", { hasText: "Emirates ID" }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("Built in");

    await row.getByRole("link").click();
    await page.waitForURL(/\/admin\/document-categories\/.+/);

    // Editable — §17 gives the client the wording and the schedule.
    await expect(page.getByLabel("Name")).toBeVisible();
    // Not removable: documents elsewhere are filed under it.
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
  });

  test("the Super Admin can add a type, change its schedule, and remove it", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.superAdmin);
    await page.goto("/admin/document-categories");

    const name = `E2E Permit ${Date.now()}`;

    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Warn this many days before expiry").fill("45, 20");
    await page.getByRole("checkbox", { name: "Customer" }).check();
    await page.getByRole("button", { name: "Add document type" }).click();
    await expect(page.locator(".alert-success")).toBeVisible();

    const row = page.locator("tr", { hasText: name }).first();
    await expect(row).toContainText("45, 20");

    await row.getByRole("link").click();
    await page.waitForURL(/\/admin\/document-categories\/.+/);

    await page.getByLabel("Warn this many days before expiry").fill("30, 10");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator(".alert-success")).toBeVisible();

    // Waits for the redirect back to the list, not for a success alert: the "Save
    // changes" alert above is still on the page, so waiting for one returned at once and
    // the check below ran before the removal had happened.
    await page.getByRole("button", { name: "Remove" }).click();
    await page.waitForURL(/\/admin\/document-categories$/);
    await expect(page.locator("tr", { hasText: name })).toHaveCount(0);
  });

  test("a type that expires must warn about it", async ({ page }) => {
    // A type marked as expiring with no reminder schedule is never announced to anyone,
    // which defeats the whole point of recording the expiry.
    await signInExpectingSuccess(page, PERSONAS.superAdmin);
    await page.goto("/admin/document-categories");

    await page.getByLabel("Name").fill(`E2E Silent ${Date.now()}`);
    await page.getByLabel("Warn this many days before expiry").fill("");
    await page.getByRole("checkbox", { name: "Customer" }).check();
    await page.getByRole("button", { name: "Add document type" }).click();

    await expect(page.locator(".alert-error")).toBeVisible();
  });

  test("is out of reach for everyone but the Super Admin", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await page.goto("/admin/document-categories");

    await expect(page.getByRole("heading", { name: "Not permitted" })).toBeVisible();
  });
});
