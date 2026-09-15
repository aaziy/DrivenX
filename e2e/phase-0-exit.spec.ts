import { expect, test, type Page } from "@playwright/test";

import {
  closeQuietly,
  GOLDEN_PASSWORD,
  PERSONAS,
  setRolePermission,
  signIn,
  signInExpectingSuccess,
  signOut,
} from "./helpers";

/**
 * The Phase 0 exit criterion, as stated in IMPLEMENTATION_PLAN.md §5:
 *
 *   "Super Admin logs in, creates an Operations user, edits that role's permissions,
 *    sees the change take effect immediately, and finds both actions in the audit log."
 *
 * The word doing the work is *immediately*. It is checked with two concurrent browser
 * contexts: the Operations user never signs out, and gains access purely because an
 * administrator changed the role in the other window. That is the observable
 * consequence of resolving permissions per request instead of embedding them in the
 * session token (packages/auth/src/rbac.ts), and this test is what stops that decision
 * being quietly reversed later.
 */

const NEW_USER_PASSWORD = "OperationsHire2026";

/** Display name of the golden Super Admin persona (packages/db/src/golden/dataset.ts). */
const SUPER_ADMIN_NAME = "Sara Al Mansoori";

function uniqueEmail(): string {
  return `ops.hire.${Date.now()}@drivenx.ae`;
}

async function createOperationsUser(page: Page, email: string): Promise<void> {
  await page.goto("/admin/users");
  await page.getByLabel("Full name").fill("Operations Hire");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Temporary password").fill(NEW_USER_PASSWORD);
  await page.getByLabel("Role").selectOption({ label: "Operations" });
  await page.getByRole("button", { name: "Create user" }).click();

  await expect(page.locator(".alert-success")).toContainText("Created Operations Hire");
}

test.describe("Phase 0 exit criterion", () => {
  // These journeys are deliberately long: two browser contexts, several sign-ins and
  // multiple permission saves. Against a dev server compiling routes on first visit,
  // the default timeout expires mid-journey and reports as a cleanup error.
  test.describe.configure({ timeout: 120_000 });

  test("a permission granted by an admin reaches a signed-in user on their next request", async ({
    browser,
  }) => {
    const adminContext = await browser.newContext();
    const opsContext = await browser.newContext();
    const admin = await adminContext.newPage();
    const ops = await opsContext.newPage();
    const email = uniqueEmail();

    try {
      // -- Super Admin signs in --
      await signInExpectingSuccess(admin, PERSONAS.superAdmin);

      // The suite runs repeatedly against a persistent database, so the starting state
      // is asserted rather than assumed. Without this a previous run's grant makes the
      // whole criterion vacuous.
      await setRolePermission(admin, "Operations", "audit.view", false);

      // -- Creates an Operations user --
      await createOperationsUser(admin, email);
      await expect(admin.locator("table.data")).toContainText(email);

      // -- That user signs in and is denied --
      await signIn(ops, email, NEW_USER_PASSWORD);
      await expect(ops.locator("aside.sidebar")).toBeVisible();
      await expect(ops.locator("aside.sidebar")).not.toContainText("Audit log");

      await ops.goto("/admin/audit");
      await expect(ops.getByText("Not permitted")).toBeVisible();

      // -- Admin grants the permission to the role --
      const changed = await setRolePermission(admin, "Operations", "audit.view", true);
      expect(changed).toBe(true);

      // -- The criterion: same session, no re-login --
      await ops.goto("/admin/audit");
      await expect(ops.getByRole("heading", { level: 1 })).toContainText("Audit log");

      await ops.goto("/");
      await expect(ops.locator("aside.sidebar")).toContainText("Audit log");

      // -- And revoking takes effect just as immediately --
      await setRolePermission(admin, "Operations", "audit.view", false);
      await ops.goto("/admin/audit");
      await expect(ops.getByText("Not permitted")).toBeVisible();

      // -- Both actions are attributable in the audit log --
      await admin.goto("/admin/audit");
      const table = admin.locator("table.data");
      await expect(table).toContainText("RolePermission");
      await expect(table).toContainText(SUPER_ADMIN_NAME);
      await expect(table).toContainText("CREATE");
    } finally {
      await closeQuietly(adminContext, opsContext);
    }
  });

  test("the audit log never exposes a password hash", async ({ page }) => {
    // The log is readable by more people than can read the users table, which is
    // exactly why it must not mirror credentials.
    await signInExpectingSuccess(page, PERSONAS.superAdmin);
    await page.goto("/admin/audit");

    const body = await page.locator("body").innerText();
    expect(body).not.toContain("argon2");
    expect(body).not.toContain("passwordHash:");
  });

  test("a created user can sign in with the password they were given", async ({ browser }) => {
    const adminContext = await browser.newContext();
    const hireContext = await browser.newContext();
    const admin = await adminContext.newPage();
    const hire = await hireContext.newPage();
    const email = uniqueEmail();

    try {
      await signInExpectingSuccess(admin, PERSONAS.superAdmin);
      await createOperationsUser(admin, email);

      await signIn(hire, email, NEW_USER_PASSWORD);
      await expect(hire.locator("aside.sidebar")).toBeVisible();

      // And not with a different one. Sign out first: the login page sends an
      // already-signed-in user straight back into the app, so without this the form
      // never appears and the test hangs until it times out.
      await signOut(hire);
      await signIn(hire, email, GOLDEN_PASSWORD);
      await expect(hire.locator(".alert-error")).toBeVisible();
    } finally {
      await closeQuietly(adminContext, hireContext);
    }
  });

  test("rejects a weak password for a new user", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.superAdmin);

    await page.goto("/admin/users");
    await page.getByLabel("Full name").fill("Weak Password");
    await page.getByLabel("Email").fill(uniqueEmail());
    await page.getByLabel("Temporary password").fill("short");
    await page.getByLabel("Role").selectOption({ label: "Operations" });
    await page.getByRole("button", { name: "Create user" }).click();

    await expect(page.locator(".alert-error")).toContainText("at least 12 characters");
  });

  test("refuses to let an administrator deactivate their own account", async ({ page }) => {
    // Unrecoverable without database access if it were allowed on the last admin.
    await signInExpectingSuccess(page, PERSONAS.superAdmin);
    await page.goto("/admin/users");

    const ownRow = page.locator(`tr:has-text("${PERSONAS.superAdmin}")`);
    await expect(ownRow).toContainText("You");
    await expect(ownRow.getByRole("button", { name: "Deactivate" })).toHaveCount(0);
  });
});
