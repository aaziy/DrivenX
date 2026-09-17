import { expect, test, type Page } from "@playwright/test";

import { expectFormControlsConsistent, PERSONAS, signInExpectingSuccess } from "./helpers";

/**
 * Documents (P1A) — attaching a file to a customer.
 *
 * The rejection test is the important one. Upload validation sniffs magic bytes and
 * ignores both the filename and the declared type, and until now that was only ever
 * proven in a unit test. This drives it through the real form.
 */

/** A real PDF header, padded so the file is not trivially small. */
const PDF_BYTES = Buffer.concat([
  Buffer.from("%PDF-1.4\n"),
  Buffer.alloc(2048, 0x20),
]);

/** MZ — a Windows executable, which is what this actually is whatever it is called. */
const EXE_BYTES = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(2048, 0)]);

async function createCustomer(page: Page): Promise<string> {
  const name = `E2E Docs ${Date.now()}`;
  await page.goto("/customers");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile").fill("052 111 2233");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.locator(".alert-success")).toBeVisible();

  await page.locator(`tr:has-text("${name}") a`).first().click();
  await page.waitForURL(/\/customers\/.+/);
  return name;
}

test.describe("documents", () => {
  test("attaches a document to a customer and offers it back", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await createCustomer(page);

    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

    // The file input sat ten pixels above its neighbours with no border, because the
    // stylesheet left file inputs natively rendered. Nothing measured this form — the
    // existing guard only ever ran on the list pages.
    await expectFormControlsConsistent(page, ".card form");

    await page.getByLabel("Document type").selectOption({ label: "Emirates ID" });
    await page.getByLabel("File").setInputFiles({
      name: "emirates-id.pdf",
      mimeType: "application/pdf",
      buffer: PDF_BYTES,
    });
    await page.getByLabel("Document number").fill("784-1990-1000000-0");
    await page.getByLabel("Expiry date").fill("2027-12-31");

    await page.getByRole("button", { name: "Attach document" }).click();
    await expect(page.locator(".alert-success")).toBeVisible();

    const row = page.locator('tr:has-text("Emirates ID")');
    await expect(row).toBeVisible();
    await expect(row).toContainText("784-1990-1000000-0");
    await expect(row.getByRole("link", { name: "Download" })).toBeVisible();
  });

  test("refuses an executable renamed as a PDF", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await createCustomer(page);

    await page.getByLabel("Document type").selectOption({ label: "Emirates ID" });
    // Filename says PDF, declared type says PDF, the bytes say Windows executable.
    await page.getByLabel("File").setInputFiles({
      name: "passport.pdf",
      mimeType: "application/pdf",
      buffer: EXE_BYTES,
    });
    await page.getByLabel("Expiry date").fill("2027-12-31");

    await page.getByRole("button", { name: "Attach document" }).click();
    await expect(page.locator(".alert-error")).toBeVisible();
  });

  test("insists on an expiry date for a document type that expires", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await createCustomer(page);

    await page.getByLabel("Document type").selectOption({ label: "Emirates ID" });
    await page.getByLabel("File").setInputFiles({
      name: "id.pdf",
      mimeType: "application/pdf",
      buffer: PDF_BYTES,
    });

    await page.getByRole("button", { name: "Attach document" }).click();
    await expect(page.locator(".alert-error")).toBeVisible();
  });

  test("a download needs a signed-in user with permission", async ({ browser }) => {
    // A fresh context: no session cookie, so the route must refuse rather than serve
    // somebody's identity document to an anonymous request.
    const context = await browser.newContext();
    const response = await context.request.get("/documents/does-not-exist/download", {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(401);
    await context.close();
  });
});
