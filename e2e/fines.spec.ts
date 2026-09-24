import { expect, test, type Page } from "@playwright/test";

import { PERSONAS, signInExpectingSuccess } from "./helpers";

/**
 * Traffic fines (P2-07, P2-08, SOW §13), through the screens.
 *
 * The rule the journey is here to prove is the one that decides whether the books are
 * right: nothing is posted for a fine until money actually moves, and recharging it
 * raises a real invoice on the customer's contract rather than a number on a screen.
 */

let serial = 0;

const card = (page: Page) =>
  page.locator(".card", { has: page.getByRole("heading", { name: "Traffic fines" }) });

const row = (page: Page, fineNumber: string) => card(page).locator("tbody tr", { hasText: fineNumber });

async function choose(page: Page, label: string, text: string) {
  const select = page.getByRole("combobox", { name: label, exact: true });
  const value = await select.locator("option", { hasText: text }).getAttribute("value");
  await select.selectOption(value ?? "");
}

/** A car out on a live contract, and the contract's page. */
async function carOnContract(page: Page) {
  serial += 1;
  const stamp = `${Date.now()}${serial}`.slice(-9);
  const name = `E2E Fined ${stamp}`;
  const plate = stamp.slice(-5);

  await page.goto("/customers");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile").fill("050 765 4321");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.locator(".alert-success")).toBeVisible();

  await page.goto("/vehicles/new");
  await page.getByLabel("Make").fill("Kia");
  await page.getByRole("textbox", { name: "Model", exact: true }).fill("Seltos");
  await page.getByRole("spinbutton", { name: "Model year" }).fill("2025");
  await page.getByLabel("Plate code").fill("J");
  await page.getByLabel("Plate number").fill(plate);
  await page.getByLabel("VIN or chassis number").fill(`KNA${stamp.padStart(14, "0")}`);
  await page.getByRole("button", { name: "Add vehicle" }).click();
  await page.waitForURL(/\/vehicles\/(?!new)[^/]+$/);
  const vehicleUrl = page.url();

  await page.goto("/contracts/new");
  await choose(page, "Customer", name);
  await choose(page, "Vehicle", plate);
  await page.getByLabel("Term (months)").fill("6");
  await page.getByRole("textbox", { name: "Monthly rental (AED, excluding VAT)" }).fill("3,000");
  await page.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/contracts\/(?!new)[^/]+$/);
  await page.getByRole("button", { name: "Activate contract" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Active");

  return { vehicleUrl, contractUrl: page.url(), name };
}

async function recordFine(page: Page, fineNumber: string) {
  const form = card(page);
  await form.getByLabel("Fine number").fill(fineNumber);
  await form.getByLabel("Authority").fill("Dubai Police");
  await form.getByRole("textbox", { name: "Amount (AED)" }).fill("600");
  await form.getByRole("button", { name: "Record fine" }).click();
  await expect(page.getByText("Fine recorded.")).toBeVisible();
}

test.describe("traffic fines", () => {
  test("a fine is paid, recharged, and appears on the customer's schedule", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    const { vehicleUrl, contractUrl, name } = await carOnContract(page);

    await page.goto(vehicleUrl);
    const fineNumber = `DXB-${Date.now()}`;
    await recordFine(page, fineNumber);

    // Recorded against the driver of the day, and owed by nobody yet.
    const fine = row(page, fineNumber);
    await expect(fine).toContainText("Open");
    await expect(fine).toContainText(name);

    // DrivenX pays the authority: now it is a cost.
    await fine.getByRole("button", { name: "DrivenX paid it" }).click();
    await expect(row(page, fineNumber)).toContainText("Paid by DrivenX");
    await expect(card(page)).toContainText("600.00 paid and not recovered");

    // And recharging it raises a real invoice. Asserted on the row rather than on a
    // message: recharging replaces the control that would have shown one.
    await row(page, fineNumber).getByRole("button", { name: "Recharge the customer" }).click();
    await expect(row(page, fineNumber)).toContainText("Recovered");
    await expect(row(page, fineNumber)).toContainText(/INV-\d{6}/);
    await expect(card(page)).not.toContainText("paid and not recovered");

    // The invoice is on the contract's schedule, at the fine's exact amount: a fine is
    // not a supply, so nothing is added on top of it.
    await page.goto(contractUrl);
    const schedule = page.locator(".card", { has: page.getByRole("heading", { name: "Payment schedule" }) });
    const recharge = schedule.locator("tbody tr", { hasText: "Traffic fine" });
    await expect(recharge).toContainText("600.00");
    await expect(recharge).not.toContainText("630.00");
  });

  test("a fine the customer settles themselves never becomes a cost", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    const { vehicleUrl } = await carOnContract(page);

    await page.goto(vehicleUrl);
    const fineNumber = `DXB-C-${Date.now()}`;
    await recordFine(page, fineNumber);

    await row(page, fineNumber).getByRole("button", { name: "Customer paid it" }).click();
    await expect(row(page, fineNumber)).toContainText("Paid by customer");
    // Nothing was ever out of pocket, so the card has no figure to show.
    await expect(card(page)).not.toContainText("paid and not recovered");
    // And it is finished: no further moves are offered.
    await expect(row(page, fineNumber).getByRole("button")).toHaveCount(0);
  });

  test("the same notice cannot be entered twice", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    const { vehicleUrl } = await carOnContract(page);

    await page.goto(vehicleUrl);
    const fineNumber = `DXB-D-${Date.now()}`;
    await recordFine(page, fineNumber);
    await recordFine(page, fineNumber).catch(() => undefined);

    await expect(
      card(page).getByText("That fine number is already recorded for this authority."),
    ).toBeVisible();
  });
});
