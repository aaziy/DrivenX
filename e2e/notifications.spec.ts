import { execSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

import { PERSONAS, signInExpectingSuccess } from "./helpers";

/**
 * Notifications (P1A-07 and P1A-08) — the milestone's stated journey, end to end:
 * a document that expires soon becomes something a person is actually told about.
 *
 * The scan is a cron job, not something the application triggers, so the spec runs it
 * the way the host will. Pointing it at the test database explicitly matters: the worker
 * reads DATABASE_URL, and without this it would scan development data and find nothing
 * while the test waited for a notification that was never coming.
 */
function runExpiryScan(): void {
  const databaseUrl = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
  execSync("pnpm --filter @drivenx/worker expiry-scan", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

/** `<input type="date">` wants YYYY-MM-DD. */
function inDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const PDF_BYTES = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(2048, 0x20)]);

async function customerWithExpiringId(page: Page): Promise<string> {
  const name = `E2E Expiry ${Date.now()}`;

  await page.goto("/customers");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile").fill("056 444 3322");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.locator(".alert-success")).toBeVisible();

  await page.locator(`tr:has-text("${name}") a`).first().click();
  await page.waitForURL(/\/customers\/.+/);

  await page.getByLabel("Document type").selectOption({ label: "Emirates ID" });
  await page.getByLabel("File").setInputFiles({
    name: "emirates-id.pdf",
    mimeType: "application/pdf",
    buffer: PDF_BYTES,
  });
  // The milestone's own example: 29 days out, inside the 30-day warning.
  await page.getByLabel("Expiry date").fill(inDays(29));
  await page.getByRole("button", { name: "Attach document" }).click();
  await expect(page.locator(".alert-success")).toBeVisible();

  return name;
}

test.describe("notifications", () => {
  test("an expiring document becomes a notification that leads back to the customer", async ({
    page,
  }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    const name = await customerWithExpiringId(page);

    runExpiryScan();

    await page.goto("/notifications");
    // Located by the customer, not by "the first expiring document": notifications
    // accumulate across runs, so the first row belongs to whoever ran the suite before.
    const row = page.locator("tr", { hasText: name }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("Document expiring");

    // The unread count reaches the sidebar, so it is noticed without opening the page.
    await expect(page.locator(".nav-badge")).toBeVisible();

    await row.getByRole("link", { name: "Open" }).click();
    await page.waitForURL(/\/customers\/.+/);
    await expect(page.getByRole("heading", { name })).toBeVisible();
  });

  test("marking a notification read clears it from the unread count", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await customerWithExpiringId(page);

    runExpiryScan();

    await page.goto("/notifications");
    await page.getByRole("button", { name: "Mark all read" }).click();

    await expect(page.getByText("All read")).toBeVisible();
    await expect(page.locator(".nav-badge")).toHaveCount(0);
  });

  test("running the scan again announces nothing new", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await customerWithExpiringId(page);

    runExpiryScan();
    await page.goto("/notifications");
    const before = await page.locator("tr", { hasText: "Document expiring" }).count();

    // The dedupe key, proven through the whole stack rather than in the job's own test:
    // a nightly job that repeats itself trains everybody to ignore the list.
    runExpiryScan();
    await page.reload();
    const after = await page.locator("tr", { hasText: "Document expiring" }).count();

    expect(after).toBe(before);
  });
});

/**
 * How a person is told (P3-01).
 *
 * The in-app list is not a setting and has no switch — it is the record that something
 * was raised at all. Email is, and this is the screen where somebody turns it off.
 */
test.describe("notification preferences", () => {
  test("email alerts can be turned off and on again", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await page.goto("/notifications");

    const card = page.locator(".card", { has: page.getByRole("heading", { name: "How you are told" }) });

    // On by default: somebody who has never opened this screen is still chased.
    await expect(card).toContainText("You are emailed about the notifications you can see");

    await card.getByRole("button", { name: "Stop emailing me" }).click();
    await expect(card).toContainText("You are not emailed");
    // And the in-app list is still there, because it is not a choice.
    await expect(page.getByRole("heading", { name: "Everything waiting" })).toBeVisible();

    await card.getByRole("button", { name: "Email me too" }).click();
    await expect(card).toContainText("You are emailed about the notifications you can see");
  });
});
