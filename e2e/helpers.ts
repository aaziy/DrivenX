import { expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * Close a context without masking a real failure.
 *
 * When a test times out, Playwright tears the context down before the `finally` block
 * runs, and the close then throws "Target page, context or browser has been closed" —
 * which replaces the actual assertion failure in the report with a cleanup error.
 */
export async function closeQuietly(...contexts: BrowserContext[]): Promise<void> {
  await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
}

/**
 * Golden dataset personas (packages/db/src/golden/dataset.ts).
 *
 * Referenced by role rather than by email so a spec reads as "sign in as Sales" —
 * which is the thing being tested — instead of as a string literal.
 */
export const PERSONAS = {
  superAdmin: "sara.admin@drivenx.ae",
  management: "omar.management@drivenx.ae",
  sales: "layla.sales@drivenx.ae",
  finance: "imran.finance@drivenx.ae",
  operations: "yusuf.ops@drivenx.ae",
  deactivated: "deactivated@drivenx.ae",
  noRoles: "noroles@drivenx.ae",
} as const;

export const GOLDEN_PASSWORD = "GoldenDataset2026";

/**
 * Sign in and wait for a definite outcome.
 *
 * Server actions finish with a client-side navigation or a re-render, and
 * `networkidle` resolves before either — waiting on it produces assertions that pass
 * or fail depending on machine speed.
 */
export async function signIn(
  page: Page,
  email: string,
  password: string = GOLDEN_PASSWORD,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Three possible outcomes, all of them settled states: the application shell, a
  // rejection on the login form, or a 403 — which is where a user whose roles grant
  // nothing lands after a perfectly successful sign-in.
  await expect(
    page.locator("aside.sidebar, .alert-error, h1:has-text('Not permitted')").first(),
  ).toBeVisible();
}

export async function signInExpectingSuccess(page: Page, email: string): Promise<void> {
  await signIn(page, email);
  await expect(page.locator("aside.sidebar")).toBeVisible();
}

export async function signOut(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Email")).toBeVisible();
}

/**
 * The permission rows occupy real space inside their group.
 *
 * Guards a defect that every other kind of check missed: a floated group heading took
 * the full width, the rows collapsed to zero and were pushed outside the container, and
 * they stayed clickable throughout — so the tests passed while the page showed nothing.
 */
export async function expectPermissionRowsLaidOut(page: Page): Promise<void> {
  const list = await page.locator(".perm-list").first().boundingBox();
  expect(list?.width ?? 0).toBeGreaterThan(200);
}

/**
 * Every control in a form is the same height.
 *
 * Guards a defect nothing else catches: the stylesheet lists the input types it styles,
 * so a field added with a type that is not on the list — `tel`, `date`, `number` —
 * renders as a bare browser default next to styled siblings. Every test still passes;
 * the form simply looks broken. Heights diverge sharply when it happens.
 */
export async function expectFormControlsConsistent(page: Page, formSelector: string) {
  const boxes = await page.locator(`${formSelector} input, ${formSelector} select`).all();
  const heights: number[] = [];

  for (const control of boxes) {
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    if (box) heights.push(box.height);
  }

  expect(heights.length).toBeGreaterThan(3);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(6);
}

/** Set one permission on a role and save. Returns true if anything changed. */
export async function setRolePermission(
  page: Page,
  roleName: string,
  permissionKey: string,
  granted: boolean,
): Promise<boolean> {
  await page.goto("/admin/roles");
  await page.locator(`tr:has-text("${roleName}") a`).click();
  await expect(page.locator('input[type="checkbox"]').first()).toBeVisible();

  // The rows once laid out at zero width and sat outside their own box, so the whole
  // editor looked empty. `toBeVisible` does not catch that — each row still reports a
  // real size — so the width of the list is measured instead.
  await expectPermissionRowsLaidOut(page);

  const checkbox = page.locator(`label:has-text("${permissionKey}") input[type="checkbox"]`);
  if ((await checkbox.isChecked()) === granted) return false;

  await checkbox.setChecked(granted);
  await page.getByRole("button", { name: "Save permissions" }).click();
  await expect(page.locator(".alert-success")).toBeVisible();
  return true;
}
