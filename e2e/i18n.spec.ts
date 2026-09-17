import { expect, test, type Page } from "@playwright/test";

import {
  closeQuietly,
  expectPermissionRowsLaidOut,
  PERSONAS,
  signInExpectingSuccess,
} from "./helpers";

/**
 * English and Arabic (SOW open question 7, answered 2026-09-16).
 *
 * Each person chooses, the choice is saved to their account, and Arabic mirrors the
 * whole layout right-to-left. Translating the text is the easy half; what needs a
 * browser is proving the layout actually mirrors and that no screen falls back to a raw
 * message key.
 */

const ARABIC = "العربية";
const ENGLISH = "English";

async function chooseLanguage(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", label === ARABIC ? "rtl" : "ltr");
}

/**
 * Visible text with identifiers removed.
 *
 * next-intl renders a missing message as its dotted key path, so "roles.save" on screen
 * means a translation is missing. Permission keys, emails, ids and timestamps are shown
 * deliberately and look the same, so they come out first — as do the framework's inline
 * scripts, which carry the serialised props.
 */
async function readableText(page: Page): Promise<string> {
  return page.locator("body").evaluate((body) => {
    const clone = body.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll("script, style, .perm-item-key, .mono, bdi")
      .forEach((element) => element.remove());
    return clone.textContent ?? "";
  });
}

const MISSING_MESSAGE =
  /\b(?:common|language|nav|login|dashboard|users|password|roles|permissionGroups|permissions|audit|forbidden|notFound|error|errors)\.[A-Za-z_]+/;

/** Leave the account in English: later specs sign in as these personas and read English. */
async function restoreEnglish(page: Page): Promise<void> {
  try {
    await page.goto("/");
    await chooseLanguage(page, ENGLISH);
  } catch {
    // A failing test has already reported the real problem; this is only cleanup.
  }
}

test.describe("language switch", () => {
  test.describe.configure({ timeout: 120_000 });

  test("the sign-in page switches to Arabic and back", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");

    await chooseLanguage(page, ARABIC);
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.getByLabel("البريد الإلكتروني")).toBeVisible();
    await expect(page.getByRole("button", { name: "تسجيل الدخول" })).toBeVisible();
    expect(await readableText(page)).not.toMatch(MISSING_MESSAGE);

    await chooseLanguage(page, ENGLISH);
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("a signed-in choice mirrors the layout and follows the person to another device", async ({
    browser,
  }) => {
    const deviceOne = await browser.newContext();
    const deviceTwo = await browser.newContext();
    const page = await deviceOne.newPage();

    try {
      await signInExpectingSuccess(page, PERSONAS.finance);
      await chooseLanguage(page, ARABIC);

      await expect(page.locator("aside.sidebar")).toContainText("لوحة التحكم");
      await expect(page.getByRole("heading", { level: 1 })).toContainText("مرحبًا");

      // Mirrored: the sidebar now sits to the right of the main content.
      const sidebar = await page.locator("aside.sidebar").boundingBox();
      const main = await page.locator("main.main").boundingBox();
      expect(sidebar?.x ?? 0).toBeGreaterThan(main?.x ?? 0);

      // A refused page is in Arabic too, including the way out of it.
      await page.goto("/admin/users");
      await expect(page.getByRole("heading", { name: "غير مسموح" })).toBeVisible();
      await expect(page.getByRole("button", { name: "تسجيل الخروج" })).toBeVisible();

      // Saved to the account, not just this browser.
      const other = await deviceTwo.newPage();
      await signInExpectingSuccess(other, PERSONAS.finance);
      await expect(other.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(other.locator("aside.sidebar")).toContainText("لوحة التحكم");
    } finally {
      await restoreEnglish(page);
      await closeQuietly(deviceOne, deviceTwo);
    }
  });

  test("every administration page renders fully in Arabic", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.superAdmin);

    try {
      await chooseLanguage(page, ARABIC);

      for (const [path, heading] of [
        ["/", "مرحبًا"],
        ["/admin/users", "المستخدمون"],
        ["/admin/roles", "الأدوار والصلاحيات"],
        ["/admin/audit", "سجل التدقيق"],
      ] as const) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
        expect(await readableText(page)).not.toMatch(MISSING_MESSAGE);
      }

      // The role editor names all 57 permissions and their groups: the largest block of
      // translated text in the app, and the easiest place to leave one behind.
      await page.goto("/admin/roles");
      await page.locator("table.data tbody tr").first().locator("a").click();
      await expect(page.locator(".perm-group-head").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "حفظ الصلاحيات" })).toBeVisible();
      await expectPermissionRowsLaidOut(page);
      expect(await readableText(page)).not.toMatch(MISSING_MESSAGE);
    } finally {
      await restoreEnglish(page);
    }
  });
});
