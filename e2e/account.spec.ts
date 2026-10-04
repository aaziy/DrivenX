import { expect, test, type Browser, type Page } from "@playwright/test";

import { PERSONAS, signIn, signInExpectingSuccess, signOut } from "./helpers";

/**
 * Changing a password, through the screens.
 *
 * The fields are found by name rather than by label: a required field's label carries a
 * trailing marker, and "New password" is also the start of "New password again".
 *
 * Until this existed a password could never change after an account was created - the
 * admin form even called the first one "temporary". Each test creates its own user:
 * changing a shared persona's password would sign every later spec out.
 */

const FIRST = "Temporary2026Pass";
const CHOSEN = "MyOwn2026Choice";
const RESET = "AdminSet2026Reset";

async function aNewUser(page: Page): Promise<{ email: string; name: string }> {
  const stamp = `${Date.now()}`.slice(-9);
  const email = `account.${stamp}@drivenx.ae`;
  const name = `Account Test ${stamp}`;
  await page.goto("/admin/users");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Temporary password").fill(FIRST);
  await page.getByLabel("Role").selectOption({ label: "Operations" });
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(page.locator(".alert-success")).toContainText(`Created ${name}`);
  return { email, name };
}

async function asUser(browser: Browser, email: string, password: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, email, password);
  await expect(page.locator("aside.sidebar")).toBeVisible();
  return page;
}

test.describe("your account", () => {
  test("a new user replaces the temporary password with their own", async ({ page, browser }) => {
    await signInExpectingSuccess(page, PERSONAS.superAdmin);
    const { email } = await aNewUser(page);

    const user = await asUser(browser, email, FIRST);
    await user.getByRole("link", { name: "Your account" }).click();
    await user.locator('input[name="currentPassword"]').fill(FIRST);
    await user.locator('input[name="newPassword"]').fill(CHOSEN);
    await user.locator('input[name="confirmPassword"]').fill(CHOSEN);
    await user.getByRole("button", { name: "Change password" }).click();
    await expect(user.locator(".alert-success")).toContainText("Password changed");

    // Still signed in here: the change renews this session rather than ending it.
    await user.goto("/");
    await expect(user.locator("aside.sidebar")).toBeVisible();

    await signOut(user);
    await signIn(user, email, FIRST);
    await expect(user.locator("aside.sidebar")).toHaveCount(0);
    await signIn(user, email, CHOSEN);
    await expect(user.locator("aside.sidebar")).toBeVisible();
  });

  test("asks for the current password and holds the new one to the policy", async ({ page, browser }) => {
    await signInExpectingSuccess(page, PERSONAS.superAdmin);
    const { email } = await aNewUser(page);
    const user = await asUser(browser, email, FIRST);
    await user.goto("/account");

    await user.locator('input[name="currentPassword"]').fill("NotMyPassword1");
    await user.locator('input[name="newPassword"]').fill(CHOSEN);
    await user.locator('input[name="confirmPassword"]').fill(CHOSEN);
    await user.getByRole("button", { name: "Change password" }).click();
    await expect(user.locator(".alert-error")).toContainText("That is not your current password.");

    await user.locator('input[name="currentPassword"]').fill(FIRST);
    await user.locator('input[name="newPassword"]').fill("short");
    await user.locator('input[name="confirmPassword"]').fill("short");
    await user.getByRole("button", { name: "Change password" }).click();
    await expect(user.locator(".alert-error")).toContainText("at least 12 characters");
  });

  test("a change signs out the user's other sessions", async ({ page, browser }) => {
    await signInExpectingSuccess(page, PERSONAS.superAdmin);
    const { email } = await aNewUser(page);

    const laptop = await asUser(browser, email, FIRST);
    const phone = await asUser(browser, email, FIRST);
    // Sessions record whole seconds, and one begun in the same second as a change is let
    // through (it may be the session the change itself starts). Real sessions are minutes
    // or hours old; a test's is milliseconds, so it has to wait to be "before".
    await laptop.waitForTimeout(1_100);

    await laptop.goto("/account");
    await laptop.locator('input[name="currentPassword"]').fill(FIRST);
    await laptop.locator('input[name="newPassword"]').fill(CHOSEN);
    await laptop.locator('input[name="confirmPassword"]').fill(CHOSEN);
    await laptop.getByRole("button", { name: "Change password" }).click();
    await expect(laptop.locator(".alert-success")).toBeVisible();

    // The other session knew the old password, so it ends.
    await phone.goto("/");
    await expect(phone).toHaveURL(/\/login/);
  });
});

test.describe("an administrator resetting a forgotten password", () => {
  test("sets a new one and signs the person out everywhere", async ({ page, browser }) => {
    await signInExpectingSuccess(page, PERSONAS.superAdmin);
    const { email, name } = await aNewUser(page);
    const user = await asUser(browser, email, FIRST);
    // See above: the session has to be from an earlier second than the reset.
    await page.waitForTimeout(1_100);

    await page.goto("/admin/users");
    const row = page.locator("tr", { hasText: email });
    await row.getByText("Set a new password").click();
    await row.getByLabel(`New password for ${name}`).fill(RESET);
    await row.getByRole("button", { name: "Set", exact: true }).click();
    await expect(row).toContainText("They have been signed out everywhere.");

    await user.goto("/");
    await expect(user).toHaveURL(/\/login/);

    await signIn(user, email, RESET);
    await expect(user.locator("aside.sidebar")).toBeVisible();
  });
});
