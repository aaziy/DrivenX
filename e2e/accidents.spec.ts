import { expect, test, type Page } from "@playwright/test";

import { PERSONAS, signInExpectingSuccess } from "./helpers";

/**
 * Accidents and claims (P2-09, P2-10, SOW §13), through the screens.
 *
 * The journey proves the rule the books depend on: a repair is a cost when it is billed,
 * an approved claim is not money, and only what the insurer actually pays comes back.
 * What is left over — the excess — stays with DrivenX, which is what the car's
 * profitability has to show.
 */

let serial = 0;

const card = (page: Page) =>
  page.locator(".card", { has: page.getByRole("heading", { name: "Accidents", exact: true }) });

async function aCar(page: Page) {
  serial += 1;
  const stamp = `${Date.now()}${serial}`.slice(-9);
  const plate = stamp.slice(-5);

  await page.goto("/vehicles/new");
  await page.getByLabel("Make").fill("Mazda");
  await page.getByRole("textbox", { name: "Model", exact: true }).fill("CX-5");
  await page.getByRole("spinbutton", { name: "Model year" }).fill("2025");
  await page.getByLabel("Plate code").fill("K");
  await page.getByLabel("Plate number").fill(plate);
  await page.getByLabel("VIN or chassis number").fill(`JM3${stamp.padStart(14, "0")}`);
  await page.getByRole("button", { name: "Add vehicle" }).click();
  await page.waitForURL(/\/vehicles\/(?!new)[^/]+$/);
  return page.url();
}

test.describe("accidents", () => {
  test("a crash is repaired, claimed for, and the excess stays with DrivenX", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    const vehicleUrl = await aCar(page);

    // -- The crash ---------------------------------------------------------
    await card(page).getByLabel("Where").fill("Sheikh Zayed Road, exit 41");
    await card(page).getByLabel("What happened").fill("Rear-ended at a standstill");
    await card(page).getByRole("button", { name: "Record accident" }).click();
    await expect(page.getByText("Accident recorded.")).toBeVisible();

    // Nobody knows whose fault it was on the day, and the record says so rather than guessing.
    await expect(card(page)).toContainText("Not yet known");
    await expect(card(page)).toContainText("Reported");

    // -- The repair --------------------------------------------------------
    await card(page).getByRole("button", { name: "Send to the garage" }).click();
    await expect(card(page)).toContainText("Under repair");

    await card(page).getByLabel("Garage").fill("Al Futtaim Bodyshop");
    await card(page).getByRole("textbox", { name: "Repair cost (AED)" }).fill("4,000");
    await card(page).getByRole("button", { name: "Record repair" }).click();

    // Asserted on the record rather than a message: a recorded bill replaces the form
    // that would have shown one. Billed net — the garage's VAT is reclaimed, not a cost.
    await expect(card(page).locator("tr", { hasText: "Repair" }).first()).toContainText("4,000.00");
    await expect(card(page)).toContainText("Al Futtaim Bodyshop");
    await expect(card(page)).toContainText("Cost to DrivenX");

    // -- The claim ---------------------------------------------------------
    await card(page).getByLabel("Claim number").fill(`CLM-${Date.now()}`);
    await card(page).getByRole("textbox", { name: "Claimed (AED)" }).fill("4,000");
    await card(page).getByRole("button", { name: "Lodge claim" }).click();
    await expect(card(page)).toContainText("Lodged");

    // Approved is not paid: the cost to DrivenX is still the whole repair.
    await card(page).getByRole("textbox", { name: "Approved (AED)" }).fill("3,500");
    await card(page).getByRole("button", { name: "Insurer approved" }).click();
    await expect(card(page)).toContainText("approved 3,500.00");
    await expect(card(page).locator("tr", { hasText: "Cost to DrivenX" })).toContainText("4,000.00");

    // Only money that arrives comes back off.
    await card(page).getByRole("textbox", { name: "Received (AED)" }).fill("3,500");
    await card(page).getByRole("button", { name: "Money received" }).click();
    await expect(card(page)).toContainText("Settled");
    // 4,000 repaired less 3,500 recovered: the 500 excess is DrivenX's.
    await expect(card(page).locator("tr", { hasText: "Cost to DrivenX" })).toContainText("500.00");

    await expect(page).toHaveURL(vehicleUrl);
  });

  test("a claim cannot be settled before the insurer has approved it", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await aCar(page);

    await card(page).getByLabel("Where").fill("Al Khail Road");
    await card(page).getByRole("button", { name: "Record accident" }).click();
    await expect(page.getByText("Accident recorded.")).toBeVisible();

    await card(page).getByLabel("Claim number").fill(`CLM-E-${Date.now()}`);
    await card(page).getByRole("textbox", { name: "Claimed (AED)" }).fill("2,000");
    await card(page).getByRole("button", { name: "Lodge claim" }).click();
    await expect(card(page)).toContainText("Lodged");

    // The screen offers only what the machine allows, so there is no way to skip a step.
    await expect(card(page).getByRole("button", { name: "Money received" })).toHaveCount(0);
    await expect(card(page).getByRole("button", { name: "Insurer approved" })).toHaveCount(1);
  });
});
