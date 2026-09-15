import { expect, test } from "@playwright/test";

import { GOLDEN_PASSWORD, PERSONAS, signIn, signInExpectingSuccess, signOut } from "./helpers";

test.describe("authentication", () => {
  test("signs in and reaches the dashboard", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.superAdmin);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Good day");
  });

  test("rejects a wrong password", async ({ page }) => {
    await signIn(page, PERSONAS.superAdmin, "definitely-not-the-password");
    await expect(page.locator(".alert-error")).toContainText("Incorrect email or password");
  });

  test("gives the same answer for an unknown email as for a wrong password", async ({ page }) => {
    // Different wording here turns the login form into a staff directory.
    await signIn(page, "nobody@drivenx.ae", GOLDEN_PASSWORD);
    await expect(page.locator(".alert-error")).toContainText("Incorrect email or password");
  });

  test("refuses a deactivated account holding the correct password", async ({ page }) => {
    await signIn(page, PERSONAS.deactivated);
    await expect(page.locator(".alert-error")).toContainText("deactivated");
    await expect(page.locator("aside.sidebar")).toHaveCount(0);
  });

  test("redirects an anonymous visitor away from a protected page", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/login/);
  });

  test("signs out and ends the session", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.superAdmin);
    await signOut(page);

    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/login/);
  });

  test("sends an already-signed-in user away from the login page", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.superAdmin);
    await page.goto("/login");
    await expect(page.locator("aside.sidebar")).toBeVisible();
  });

  test("stamps every response with a correlation id", async ({ page }) => {
    // P0-13: the id links what a user saw to the log lines behind it.
    const response = await page.goto("/login");
    expect(response?.headers()["x-request-id"]).toBeTruthy();
  });
});

test.describe("a user with no roles", () => {
  test("signs in successfully but can reach nothing", async ({ page }) => {
    // Authentication and authorisation are separate: valid credentials are not access.
    // No sidebar is expected. The dashboard itself is refused, so the first thing this
    // user sees after a perfectly successful sign-in is the 403 page.
    await signIn(page, PERSONAS.noRoles);
    await expect(page.getByRole("heading", { name: "Not permitted" })).toBeVisible();

    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "Not permitted" })).toBeVisible();
  });

  test("is not trapped on the 403 page", async ({ page }) => {
    // The 403 page renders outside the application shell, so it carries no navigation.
    // Before it had its own sign-out button, a user whose roles granted nothing had no
    // way to leave it: "Back to dashboard" is refused for exactly these users.
    await signIn(page, PERSONAS.noRoles);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("Email")).toBeVisible();

    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });
});
