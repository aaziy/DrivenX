import { expect, test, type Page } from "@playwright/test";

import { PERSONAS, signInExpectingSuccess, signOut } from "./helpers";

/**
 * Leads (milestone 1F). The plan's two tests that matter: a lead goes all the way to a
 * contract with the salesperson's name on it, and one salesperson cannot read another's
 * leads. The rules are proven against Postgres one layer down; this proves the screens.
 */

const HANA = "hana.sales@drivenx.ae";

let serial = 0;
const stamp = () => {
  serial += 1;
  return `${Date.now()}${serial}`.slice(-9);
};

/** A mobile no other test uses: 050 + seven digits from the stamp. */
const mobileFor = (s: string) => `050${s.slice(-7)}`;

async function addCar(page: Page, s: string) {
  await page.goto("/vehicles/new");
  await page.getByLabel("Make").fill("Kia");
  await page.getByRole("textbox", { name: "Model", exact: true }).fill("Sportage");
  await page.getByRole("spinbutton", { name: "Model year" }).fill("2025");
  await page.getByLabel("Plate code").fill("S");
  await page.getByLabel("Plate number").fill(s.slice(-5));
  await page.getByLabel("VIN or chassis number").fill(`KNA${s.padStart(14, "0")}`);
  await page.getByRole("button", { name: "Add vehicle" }).click();
  await page.waitForURL(/\/vehicles\/(?!new)[^/]+$/);
}

async function newLead(page: Page, name: string, mobile: string) {
  await page.goto("/leads/new");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Mobile").fill(mobile);
  await page.getByRole("button", { name: "Create lead" }).click();
  await page.waitForURL(/\/leads\/(?!new)[^/]+$/);
  return page.url();
}

async function moveTo(page: Page, status: string, reason?: string) {
  await page.getByLabel("Move to").selectOption({ label: status });
  if (reason) await page.getByLabel("Why was it lost?").fill(reason);
  await page.getByRole("button", { name: "Move", exact: true }).click();
}

test.describe("leads", () => {
  test("a lead goes from walk-in to a contract credited to its salesperson", async ({ page }) => {
    const s = stamp();
    await signInExpectingSuccess(page, PERSONAS.management);
    await addCar(page, s);
    await signOut(page);

    // Layla records the lead, works it, and prices a deal.
    await signInExpectingSuccess(page, PERSONAS.sales);
    const leadUrl = await newLead(page, `E2E Prospect ${s}`, mobileFor(s));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("New");

    await moveTo(page, "Contacted");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Contacted");

    const vehicle = page.getByLabel("Vehicle", { exact: true });
    const value = await vehicle.locator("option", { hasText: `S ${s.slice(-5)}` }).getAttribute("value");
    await vehicle.selectOption(value ?? "");
    await page.getByLabel("Term (months)", { exact: true }).first().fill("12");
    await page.getByLabel("Monthly rental (AED, excluding VAT)").fill("3,200");
    await expect(page.getByText("12 instalments: AED 38,400.00 before VAT, AED 40,320.00 with VAT.")).toBeVisible();
    await page.getByRole("button", { name: "Save deal" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Deal created");
    await expect(page.getByText("AED 3,200.00 a month")).toBeVisible();
    await signOut(page);

    // Omar converts it; the contract still names Layla.
    await signInExpectingSuccess(page, PERSONAS.management);
    await page.goto(leadUrl);
    await expect(page.getByText("credited to Layla")).toBeVisible();
    await page.getByRole("button", { name: "Create draft contract" }).click();
    await page.waitForURL(/\/contracts\/(?!new)[^/]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Draft");
    await expect(page.locator(".page-subtitle")).toContainText("Sold by Layla");
    await expect(page.locator(".page-subtitle")).toContainText(`E2E Prospect ${s}`);

    await page.goto(leadUrl);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Contracted");
    await expect(page.getByRole("link", { name: "Open contract" })).toBeVisible();
  });

  test("losing a lead asks why, and a lost lead can be reopened", async ({ page }) => {
    const s = stamp();
    await signInExpectingSuccess(page, PERSONAS.sales);
    await newLead(page, `E2E Lost ${s}`, mobileFor(s));

    await moveTo(page, "Lost");
    await expect(page.getByText("Say why the lead was lost.")).toBeVisible();

    await moveTo(page, "Lost", "Bought elsewhere");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Lost");
    await expect(page.getByText("Bought elsewhere").first()).toBeVisible();

    await moveTo(page, "Contacted");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Contacted");
  });

  test("a salesperson sees only their own leads; a manager sees everyone's", async ({ page }) => {
    const s = stamp();
    await signInExpectingSuccess(page, PERSONAS.sales);
    const leadUrl = await newLead(page, `E2E Private ${s}`, mobileFor(s));
    await signOut(page);

    await signInExpectingSuccess(page, HANA);
    await page.goto(`/leads?q=${s}`);
    await expect(page.getByText(`E2E Private ${s}`)).toHaveCount(0);
    const response = await page.goto(leadUrl);
    expect(response?.status()).toBe(404);
    await signOut(page);

    await signInExpectingSuccess(page, PERSONAS.management);
    await page.goto(`/leads?q=${encodeURIComponent(`E2E Private ${s}`)}`);
    await expect(page.getByRole("link", { name: /^LEAD-\d{5}$/ })).toHaveCount(1);
  });

  test("the board shows a column per stage", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await page.goto("/leads");
    await page.getByRole("link", { name: "Board", exact: true }).click();
    for (const stage of ["New", "Contacted", "Qualified", "Deal created", "Contracted", "Lost"]) {
      await expect(page.getByRole("region", { name: stage })).toBeVisible();
    }
  });
});
