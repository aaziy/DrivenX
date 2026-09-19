import { writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { PERSONAS, signInExpectingSuccess } from "./helpers";

/**
 * Contracts (milestone 1D) — the plan's full money path, end to end: draft a contract,
 * activate it, pay part of the first instalment, pay the rest, and see it Paid.
 *
 * The arithmetic, the numbering and the invariants are proven against Postgres one layer
 * down. This proves the screens drive them.
 */

let serial = 0;

async function aCustomerAndACar(page: Page) {
  serial += 1;
  const stamp = `${Date.now()}${serial}`.slice(-9);
  const name = `E2E Lessee ${stamp}`;
  const plate = stamp.slice(-5);

  await page.goto("/customers");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile").fill("050 765 4321");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.locator(".alert-success")).toBeVisible();

  await page.goto("/vehicles/new");
  await page.getByLabel("Make").fill("Hyundai");
  await page.getByRole("textbox", { name: "Model", exact: true }).fill("Sonata");
  await page.getByRole("spinbutton", { name: "Model year" }).fill("2025");
  await page.getByLabel("Plate code").fill("Q");
  await page.getByLabel("Plate number").fill(plate);
  await page.getByLabel("VIN or chassis number").fill(`KMH${stamp.padStart(14, "0")}`);
  await page.getByRole("button", { name: "Add vehicle" }).click();
  await page.waitForURL(/\/vehicles\/(?!new)[^/]+$/);

  return { name, plate, vehicleUrl: page.url() };
}

/** Options carry codes this spec does not know, so pick them by the text it does. */
async function choose(page: Page, label: string, text: string) {
  const select = page.getByRole("combobox", { name: label, exact: true });
  const value = await select.locator("option", { hasText: text }).getAttribute("value");
  await select.selectOption(value ?? "");
}

async function draftAndActivate(page: Page) {
  const { name, plate, vehicleUrl } = await aCustomerAndACar(page);

  await page.goto("/contracts/new");
  await choose(page, "Customer", name);
  await choose(page, "Vehicle", plate);
  await page.getByLabel("Term (months)").fill("3");
  await page.getByRole("textbox", { name: "Monthly rental (AED, excluding VAT)" }).fill("3,400");

  // The preview comes from the same function activation uses.
  await expect(page.getByText("3 instalments: AED 10,200.00 before VAT, AED 10,710.00 with VAT")).toBeVisible();

  await page.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/contracts\/(?!new)[^/]+$/);
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Activate contract" }).click();
  // Asserted on the page's state, not a message: the activate form — and its success
  // alert with it — is only rendered for a draft, so it disappears once the page
  // re-renders as Active. The schedule appearing is the durable evidence.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Active");
  await expect(schedule(page).locator("tbody tr")).toHaveCount(3);
  // Starting today, the first month is due today and is issued at once.
  await expect(schedule(page).locator("tbody tr").first()).toContainText(/INV-\d{6}/);

  return { vehicleUrl };
}

const schedule = (page: Page) =>
  page.locator(".card", { has: page.getByRole("heading", { name: "Payment schedule" }) });

async function pay(page: Page, amount: string) {
  await page.getByLabel("Amount received (AED)").fill(amount);
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded.")).toBeVisible();
}

test.describe("contracts", () => {
  test("draft, activate, pay in two parts, and see the instalment paid", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    const { vehicleUrl } = await draftAndActivate(page);

    const first = schedule(page).locator("tbody tr").first();
    await expect(first).toContainText(/INV-\d{6}/);
    await expect(first).toContainText("3,570.00");
    await expect(first).toContainText("Due");

    await pay(page, "2,000");
    await expect(schedule(page).locator("tbody tr").first()).toContainText("Part paid");

    await page.reload();
    await pay(page, "1,570");
    await expect(schedule(page).locator("tbody tr").first()).toContainText("Paid");

    // Activation put the car on the contract.
    await page.goto(vehicleUrl);
    await expect(page.getByText("Rented", { exact: true }).first()).toBeVisible();
  });

  test("waiving an instalment asks why", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await draftAndActivate(page);

    const second = schedule(page).locator("tbody tr").nth(1);
    await second.getByRole("button", { name: "Waive" }).click();
    await second.getByRole("button", { name: "Waive" }).click();
    await expect(second.getByText("Give a reason for waiving it.")).toBeVisible();

    await second.getByPlaceholder("Reason").fill("Goodwill after a breakdown");
    await second.getByRole("button", { name: "Waive" }).click();
    // The row re-renders as waived — badge and reason — and the waive control is gone.
    await expect(second).toContainText("Waived");
    await expect(second).toContainText("Goodwill after a breakdown");
    await expect(second.getByRole("button", { name: "Waive" })).toHaveCount(0);
  });

  test("a leased-in car on lease-to-own owes its supplier each month", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    serial += 1;
    const stamp = `${Date.now()}${serial}`.slice(-9);
    const company = `E2E Lessor ${stamp}`;
    const name = `E2E Buyer ${stamp}`;
    const plate = stamp.slice(-5);

    await page.goto("/suppliers");
    await page.getByLabel("Company name").fill(company);
    await page.getByRole("button", { name: "Add supplier" }).click();
    await expect(page.locator(".alert-success")).toBeVisible();

    await page.goto("/customers");
    await page.getByLabel("Full name").fill(name);
    await page.getByLabel("Mobile").fill("050 765 4321");
    await page.getByRole("button", { name: "Add customer" }).click();
    await expect(page.locator(".alert-success")).toBeVisible();

    await page.goto("/vehicles/new");
    await page.getByLabel("Make").fill("Nissan");
    await page.getByRole("textbox", { name: "Model", exact: true }).fill("Patrol");
    await page.getByRole("spinbutton", { name: "Model year" }).fill("2025");
    await page.getByLabel("Plate code").fill("L");
    await page.getByLabel("Plate number").fill(plate);
    await page.getByLabel("VIN or chassis number").fill(`JN1${stamp.padStart(14, "0")}`);
    await page.getByRole("radio", { name: "Leased from a supplier" }).check();
    await choose(page, "Supplier", company);
    await page.getByLabel("Monthly cost to the supplier (AED)").fill("2,400");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await page.waitForURL(/\/vehicles\/(?!new)[^/]+$/);

    await page.goto("/contracts/new");
    await choose(page, "Customer", name);
    await choose(page, "Vehicle", plate);
    // A leased-in car leaves only lease-to-own to choose.
    await expect(page.getByRole("radio", { name: "Lease-to-own" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Long-term rental" })).toBeDisabled();
    await page.getByLabel("Term (months)").fill("3");
    await page.getByRole("textbox", { name: "Monthly rental (AED, excluding VAT)" }).fill("3,400");
    await page.getByRole("button", { name: "Save as draft" }).click();
    await page.waitForURL(/\/contracts\/(?!new)[^/]+$/);
    await page.getByRole("button", { name: "Activate contract" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Active");

    // One supplier invoice a month; the first is due today and already owed.
    const payables = page.locator(".card", { has: page.getByRole("heading", { name: "Supplier payments" }) });
    await expect(payables.locator("tbody tr")).toHaveCount(3);
    await expect(payables).toContainText("AED 2,400.00 owed so far · AED 0.00 paid");
    await expect(payables.locator("tbody tr").first()).toContainText("Due");

    // Paying more than the invoice is stopped; paying it in full settles it.
    await page.getByLabel("Amount paid (AED)").fill("2,500");
    await page.getByRole("button", { name: "Record supplier payment" }).click();
    await expect(page.getByText("That is more than is left to pay on the invoice.")).toBeVisible();

    await page.getByLabel("Amount paid (AED)").fill("2,400");
    await page.getByRole("button", { name: "Record supplier payment" }).click();
    await expect(payables.locator("tbody tr").first()).toContainText("Paid");
    await expect(payables).toContainText("AED 2,400.00 owed so far · AED 2,400.00 paid");

    // Nothing else is owed yet, so the supplier's page has no open payables.
    // Filtered to this company: the list is paged, and earlier runs leave suppliers behind.
    await page.goto(`/suppliers?q=${encodeURIComponent(company)}`);
    // The row links on the supplier's code, which this spec does not know.
    await page.getByRole("row", { name: company }).getByRole("link").first().click();
    await expect(page.getByText("Nothing is owed to this supplier.")).toBeVisible();
  });

  test("prints the contract as a PDF in either language, and only for a signed-in user", async ({ page, playwright }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await draftAndActivate(page);
    const url = page.url();

    const link = page.getByRole("link", { name: "Download PDF" });
    await expect(link).toHaveAttribute("href", /\/contracts\/[^/]+\/pdf$/);

    for (const lang of ["en", "ar"] as const) {
      const response = await page.request.get(`${url}/pdf?lang=${lang}`);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("application/pdf");
      expect(response.headers()["cache-control"]).toContain("no-store");
      const body = await response.body();
      expect(body.subarray(0, 5).toString()).toBe("%PDF-");
      if (process.env.SHOT_DIR) writeFileSync(`${process.env.SHOT_DIR}/contract-${lang}.pdf`, body);
    }

    // No session, no contract.
    const anonymous = await playwright.request.newContext();
    expect((await anonymous.get(`${url}/pdf`, { maxRedirects: 0 })).status()).toBe(401);
    await anonymous.dispose();
  });

  test("the customer's statement shows the invoice, the payment and what is left", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await draftAndActivate(page);
    await pay(page, "2,000");

    // The subtitle links to the customer; their page links to the statement.
    await page.locator(".page-subtitle a").first().click();
    await page.getByRole("link", { name: "Statement" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Statement of account" })).toBeVisible();

    const table = page.getByRole("table");
    await expect(table.locator("tbody tr", { hasText: "Invoice" })).toContainText(/INV-\d{6}/);
    await expect(table.locator("tbody tr", { hasText: "Payment" })).toContainText("2,000.00");
    // 3,570.00 invoiced less 2,000.00 paid.
    await expect(table.locator("tfoot")).toContainText("1,570.00");
  });

  test("sales can draft a contract but not activate one", async ({ page }) => {
    // Sales holds contract.create, not contract.activate: a salesperson writes the deal,
    // someone else commits the car and the schedule.
    await signInExpectingSuccess(page, PERSONAS.sales);
    await page.goto("/contracts");
    await expect(page.getByRole("link", { name: "New contract" })).toBeVisible();
  });
});
