import { expect, test, type Page } from "@playwright/test";

import { expectFormControlsConsistent, PERSONAS, signInExpectingSuccess, signOut } from "./helpers";

/**
 * Fleet (milestone 1B) — the journeys, end to end.
 *
 * The rules themselves (all 81 status pairs, the odometer, the constraints) are proven one
 * layer down against the pure functions and Postgres. What is proven here is that the
 * screens use them: the status control offers only legal moves, a backwards reading is
 * refused with a message that says why, and a leased car cannot be saved without its
 * supplier.
 */

let serial = 0;

/** A plate and a 17-character VIN that no other run or test will have used. */
function uniqueIdentity() {
  serial += 1;
  const stamp = `${Date.now()}${serial}`.slice(-9);
  return {
    // Digits only, so the VIN can never contain I, O or Q.
    vin: `JTD${stamp.padStart(14, "0")}`,
    plateCode: String.fromCharCode(65 + (serial % 20)),
    plateNumber: stamp.slice(-5),
  };
}

async function fillVehicle(page: Page, identity = uniqueIdentity()) {
  await page.getByLabel("Make").fill("Toyota");
  // By role: the label reads "Model *", and a plain label match also hits "Model year".
  await page.getByRole("textbox", { name: "Model", exact: true }).fill("Camry");
  await page.getByRole("spinbutton", { name: "Model year" }).fill("2024");
  await page.getByLabel("Plate code").fill(identity.plateCode);
  await page.getByLabel("Plate number").fill(identity.plateNumber);
  await page.getByLabel("VIN or chassis number").fill(identity.vin);
  return identity;
}

async function addCompanyVehicle(page: Page, mileage = "12500") {
  await page.goto("/vehicles/new");
  const identity = await fillVehicle(page);
  await page.getByLabel("Current mileage (km)").fill(mileage);
  await page.getByLabel("Purchase price (AED)").fill("85,000");
  await page.getByRole("button", { name: "Add vehicle" }).click();
  await page.waitForURL(/\/vehicles\/(?!new)[^/]+$/);
  return identity;
}

test.describe("fleet", () => {
  test("adds a vehicle and lands on its record, with its history started", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);

    // A link styled as a button must be shaped like one. The shape once lived only on
    // the `button` element, and every such link rendered as underlined coloured text.
    await page.goto("/vehicles");
    const addLink = page.getByRole("link", { name: "Add vehicle" });
    expect(await addLink.evaluate((el) => getComputedStyle(el).paddingTop)).toBe("8px");
    expect(await addLink.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("none");

    await page.goto("/vehicles/new");
    await expectFormControlsConsistent(page, ".card form");

    await addCompanyVehicle(page);

    await expect(page.getByText(/VEH-\d{5,}/).first()).toBeVisible();
    await expect(page.getByText("Joined the fleet")).toBeVisible();
    await expect(page.getByText("12,500 km").first()).toBeVisible();
  });

  test("offers only the moves the status allows, and records why", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await addCompanyVehicle(page);

    await page.getByLabel("Change to").selectOption({ label: "Maintenance" });
    await page.getByLabel("Reason").fill("Scheduled service");
    await page.getByRole("button", { name: "Change status" }).click();

    await expect(page.getByText("Available → Maintenance")).toBeVisible();
    await expect(page.getByText("Scheduled service")).toBeVisible();

    // From the workshop a car can only go back into the fleet or out of it — never
    // straight to a customer.
    const options = await page.getByLabel("Change to").locator("option:not([disabled])").allTextContents();
    expect(options.sort()).toEqual(["Available", "Inactive"]);
  });

  test("refuses an odometer reading that goes backwards", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await addCompanyVehicle(page, "20000");

    await page.getByLabel("New reading (km)").fill("21500");
    await page.getByRole("button", { name: "Record reading" }).click();
    await expect(page.getByText("Reading recorded.")).toBeVisible();

    await page.getByLabel("New reading (km)").fill("19000");
    await page.getByRole("button", { name: "Record reading" }).click();
    await expect(page.getByText("The odometer already reads 21,500 km")).toBeVisible();
  });

  test("will not save a leased car without its supplier", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await page.goto("/vehicles/new");

    await fillVehicle(page);
    await page.getByRole("radio", { name: "Leased from a supplier" }).check();
    await page.getByLabel("Monthly cost to the supplier (AED)").fill("2,400");
    await page.getByRole("button", { name: "Add vehicle" }).click();

    await expect(page.getByText("A leased vehicle needs its supplier.")).toBeVisible();
  });

  test("refuses a second vehicle with the same VIN", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    const first = await addCompanyVehicle(page);

    await page.goto("/vehicles/new");
    await fillVehicle(page, { ...uniqueIdentity(), vin: first.vin });
    await page.getByRole("button", { name: "Add vehicle" }).click();

    await expect(page.getByText("is already in the fleet")).toBeVisible();
  });

  test("treats a sale as final", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await addCompanyVehicle(page);

    await page.getByLabel("Change to").selectOption({ label: "Sold" });
    await page.getByRole("button", { name: "Change status" }).click();

    await expect(page.getByText("Sold is final")).toBeVisible();
    await expect(page.getByLabel("Change to")).toHaveCount(0);
  });

  test("offers a car leased from a supplier only lease-to-own", async ({ page }) => {
    // The client's rule (2026-09-18): a leased-in car never goes on a plain rental and is
    // never sold except at the end of a lease-to-own.
    await signInExpectingSuccess(page, PERSONAS.management);

    const company = `E2E Lessor ${Date.now()}`;
    await page.goto("/suppliers");
    await page.getByLabel("Company name").fill(company);
    await page.getByRole("button", { name: "Add supplier" }).click();
    await expect(page.locator(".alert-success")).toBeVisible();

    await page.goto("/vehicles/new");
    await fillVehicle(page);
    await page.getByRole("radio", { name: "Leased from a supplier" }).check();
    // By role: the label reads "Supplier *". The option is found by the company name,
    // since its full text also carries a supplier code this spec does not know.
    const supplierSelect = page.getByRole("combobox", { name: "Supplier", exact: true });
    const supplierValue = await supplierSelect
      .locator("option", { hasText: company })
      .getAttribute("value");
    await supplierSelect.selectOption(supplierValue ?? "");
    await page.getByLabel("Monthly cost to the supplier (AED)").fill("2,400");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await page.waitForURL(/\/vehicles\/(?!new)[^/]+$/);

    const options = await page
      .getByLabel("Change to")
      .locator("option:not([disabled])")
      .allTextContents();
    expect(options).toContain("Lease-to-own");
    expect(options).not.toContain("Rented");
    expect(options).not.toContain("Sold");
    await expect(page.getByText("goes to customers only on lease-to-own")).toBeVisible();
  });

  test("sales can see the fleet but cannot add to it or move a car", async ({ page }) => {
    // Sales holds vehicle.view only — enough to quote a car, not to change the fleet.
    await signInExpectingSuccess(page, PERSONAS.management);
    await addCompanyVehicle(page);
    const url = page.url();

    // The helper waits for the login page; clicking "Sign out" and navigating straight
    // away left the old session in place, and the next sign-in landed on Omar's dashboard.
    await signOut(page);
    await signInExpectingSuccess(page, PERSONAS.sales);

    await page.goto("/vehicles");
    await expect(page.getByRole("link", { name: "Add vehicle" })).toHaveCount(0);

    await page.goto(url);
    await expect(page.getByLabel("Change to")).toHaveCount(0);
    await expect(page.getByText("You do not have permission to edit this vehicle.")).toBeVisible();
  });
});
