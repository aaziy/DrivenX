import { expect, test } from "@playwright/test";

import { PERSONAS, signInExpectingSuccess } from "./helpers";

/**
 * Role boundaries from SOW §2, exercised through the browser.
 *
 * The unit tests in packages/auth already assert these against the permission
 * catalogue. What only a browser can prove is that each page actually calls
 * `requirePermission` — a route that forgets to would pass every unit test.
 */

test.describe("Sales Staff", () => {
  test.beforeEach(async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.sales);
  });

  test("sees no administration section", async ({ page }) => {
    const sidebar = page.locator("aside.sidebar");
    await expect(sidebar).not.toContainText("Users");
    await expect(sidebar).not.toContainText("Roles & permissions");
    await expect(sidebar).not.toContainText("Audit log");
  });

  test("is refused the user administration page by direct URL", async ({ page }) => {
    // Hiding a link is usability, not security — the URL is still reachable.
    await page.goto("/admin/users");
    await expect(page.getByText("Not permitted")).toBeVisible();
  });

  test("is refused the role editor by direct URL", async ({ page }) => {
    await page.goto("/admin/roles");
    await expect(page.getByText("Not permitted")).toBeVisible();
  });

  test("is refused the audit log by direct URL", async ({ page }) => {
    await page.goto("/admin/audit");
    await expect(page.getByText("Not permitted")).toBeVisible();
  });

  test("can reach the dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Good day");
  });
});

test.describe("Operations", () => {
  test("cannot administer users or roles", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.operations);

    await page.goto("/admin/users");
    await expect(page.getByText("Not permitted")).toBeVisible();

    await page.goto("/admin/roles");
    await expect(page.getByText("Not permitted")).toBeVisible();
  });
});

test.describe("Admin / Management", () => {
  test("can view the audit log but not administer users", async ({ page }) => {
    // §2 gives Management the business surface; user and role administration stays
    // with the Super Admin.
    await signInExpectingSuccess(page, PERSONAS.management);

    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Audit log");

    await page.goto("/admin/users");
    await expect(page.getByText("Not permitted")).toBeVisible();
  });
});

test.describe("Super Admin", () => {
  test("reaches every administration page", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.superAdmin);

    for (const [path, heading] of [
      ["/admin/users", "Users"],
      ["/admin/roles", "Roles & permissions"],
      ["/admin/audit", "Audit log"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
    }
  });
});
