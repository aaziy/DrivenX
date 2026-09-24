import { expect, test, type Page } from "@playwright/test";

import { PERSONAS, signInExpectingSuccess } from "./helpers";

/**
 * Extended profitability and the lifetime view (P2-13, P2-14), through the screens.
 *
 * What this proves that the database tests cannot: the breakdown names Phase 2's costs
 * on screen instead of folding them all into "other cost", and a car's page can answer
 * whether the car was worth owning.
 */

let serial = 0;

const lifetime = (page: Page) =>
  page.locator(".card", { has: page.getByRole("heading", { name: "Lifetime profit and loss" }) });

async function aCarWithAService(page: Page) {
  serial += 1;
  const stamp = `${Date.now()}${serial}`.slice(-9);
  const plate = stamp.slice(-5);

  await page.goto("/vehicles/new");
  await page.getByLabel("Make").fill("Toyota");
  await page.getByRole("textbox", { name: "Model", exact: true }).fill("Land Cruiser");
  await page.getByRole("spinbutton", { name: "Model year" }).fill("2025");
  await page.getByLabel("Plate code").fill("P");
  await page.getByLabel("Plate number").fill(plate);
  await page.getByLabel("VIN or chassis number").fill(`JTL${stamp.padStart(14, "0")}`);
  await page.getByRole("spinbutton", { name: "Current mileage (km)" }).fill("10000");
  await page.getByRole("button", { name: "Add vehicle" }).click();
  await page.waitForURL(/\/vehicles\/(?!new)[^/]+$/);
  const url = page.url();

  // A service, so the car has a cost to its name.
  const maintenance = page.locator(".card", { has: page.getByRole("heading", { name: "Maintenance" }) });
  await maintenance.getByLabel("Garage").fill("Al Habtoor Motors");
  await maintenance.getByRole("spinbutton", { name: "Odometer" }).fill("12000");
  await maintenance.getByRole("textbox", { name: "Cost" }).fill("800");
  await maintenance.getByRole("button", { name: "Record work" }).click();
  await expect(page.getByText("Work recorded.")).toBeVisible();

  return url;
}

test.describe("a car's lifetime profit and loss", () => {
  test("says what a car has cost when it has earned nothing", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await aCarWithAService(page);

    // A service and no rent: the car is down by the net of the bill, and the card says
    // so rather than rounding a loss away at zero.
    await expect(lifetime(page)).toContainText("800.00");
    await expect(lifetime(page)).toContainText("-800.00");
    // And it names the cost rather than calling it "other".
    await expect(lifetime(page)).toContainText("Maintenance");
  });

  test("is quiet about a car that has done nothing yet", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    serial += 1;
    const stamp = `${Date.now()}${serial}`.slice(-9);

    await page.goto("/vehicles/new");
    await page.getByLabel("Make").fill("Kia");
    await page.getByRole("textbox", { name: "Model", exact: true }).fill("Picanto");
    await page.getByRole("spinbutton", { name: "Model year" }).fill("2025");
    await page.getByLabel("Plate code").fill("R");
    await page.getByLabel("Plate number").fill(stamp.slice(-5));
    await page.getByLabel("VIN or chassis number").fill(`KNA${stamp.padStart(14, "0")}`);
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await page.waitForURL(/\/vehicles\/(?!new)[^/]+$/);

    await expect(lifetime(page)).toContainText("has not earned or cost anything yet");
  });
});

test.describe("the profitability breakdown", () => {
  test("names Phase 2's costs instead of folding them into one lump", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await aCarWithAService(page);

    await page.goto("/reports/profitability");
    const breakdown = page.locator(".card", { has: page.getByRole("heading", { name: "Where the money went" }) });

    await expect(breakdown).toBeVisible();
    await expect(breakdown).toContainText("Money out");
    await expect(breakdown).toContainText("Maintenance");
  });
});
