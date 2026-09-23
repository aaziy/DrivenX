import { writeFileSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { PERSONAS, signInExpectingSuccess } from "./helpers";

/**
 * Handover and return (P2-01 – P2-04, SOW §12), through the screens.
 *
 * The journey the milestone asks for, as far as Phase 2 has been built: the car goes out
 * with its condition recorded and signed for, comes back on a higher odometer, and the
 * kilometres over the contract's allowance appear as a figure staff can settle against.
 *
 * The arithmetic and the rules are proven against Postgres one layer down. This proves
 * the screens drive them — including the two things only a browser can show: that a mark
 * placed on the diagram lands on the panel under the pointer, and that a signature drawn
 * with a pointer reaches storage.
 */

let serial = 0;

const card = (page: Page) =>
  page.locator(".card", { has: page.getByRole("heading", { name: "Handover and return" }) });

const section = (page: Page, title: "Handover" | "Return") =>
  card(page).locator("div", { has: page.getByRole("heading", { name: title, exact: true }) }).first();

/** Options carry codes this spec does not know, so pick them by the text it does. */
async function choose(page: Page, label: string, text: string) {
  const select = page.getByRole("combobox", { name: label, exact: true });
  const value = await select.locator("option", { hasText: text }).getAttribute("value");
  await select.selectOption(value ?? "");
}

/** A contract with a mileage allowance, live, with the car reading 20,000 km. */
async function liveContract(page: Page) {
  serial += 1;
  const stamp = `${Date.now()}${serial}`.slice(-9);
  const name = `E2E Driver ${stamp}`;
  const plate = stamp.slice(-5);

  await page.goto("/customers");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile").fill("050 765 4321");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.locator(".alert-success")).toBeVisible();

  await page.goto("/vehicles/new");
  await page.getByLabel("Make").fill("Nissan");
  await page.getByRole("textbox", { name: "Model", exact: true }).fill("Patrol");
  await page.getByRole("spinbutton", { name: "Model year" }).fill("2025");
  await page.getByLabel("Plate code").fill("H");
  await page.getByLabel("Plate number").fill(plate);
  await page.getByLabel("VIN or chassis number").fill(`JN1${stamp.padStart(14, "0")}`);
  await page.getByRole("spinbutton", { name: "Current mileage (km)" }).fill("20000");
  await page.getByRole("button", { name: "Add vehicle" }).click();
  await page.waitForURL(/\/vehicles\/(?!new)[^/]+$/);

  await page.goto("/contracts/new");
  await choose(page, "Customer", name);
  await choose(page, "Vehicle", plate);
  await page.getByLabel("Term (months)").fill("3");
  await page.getByRole("textbox", { name: "Monthly rental (AED, excluding VAT)" }).fill("3,400");
  await page.getByLabel("Mileage allowance (km)").fill("5000");
  await page.getByRole("textbox", { name: "Excess mileage rate (AED per km)" }).fill("0.50");
  await page.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/contracts\/(?!new)[^/]+$/);

  await page.getByRole("button", { name: "Activate contract" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Active");

  return { url: page.url(), name };
}

/**
 * Draw a short stroke on a signature pad, the way a finger would.
 *
 * Scrolled into view first: `page.mouse` works in viewport coordinates and does not
 * scroll, so a pad below the fold would be signed somewhere else entirely.
 */
async function sign(page: Page, label: string) {
  const pad = page.getByLabel(label, { exact: true });
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  if (!box) throw new Error(`no signature pad for ${label}`);
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 20, { steps: 8 });
  await page.mouse.move(box.x + 110, box.y + box.height - 20, { steps: 8 });
  await page.mouse.up();
}

/** Mark the car at a fraction of the diagram, the way a fingertip picks a panel. */
async function markAt(diagram: Locator, xFraction: number, yFraction: number) {
  await diagram.scrollIntoViewIfNeeded();
  const box = await diagram.boundingBox();
  if (!box) throw new Error("no diagram");
  // Element-relative, so Playwright scrolls and hit-tests it for us.
  await diagram.click({ position: { x: box.width * xFraction, y: box.height * yFraction } });
}

test.describe("handover and return", () => {
  test("the car goes out marked and signed for, and comes back over its allowance", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    const { url } = await liveContract(page);

    // -- Out --------------------------------------------------------------
    const out = section(page, "Handover");
    await out.getByRole("spinbutton", { name: "Odometer" }).fill("20000");
    await out.getByRole("combobox", { name: "Fuel" }).selectOption("8");
    await out.getByRole("textbox", { name: "Condition" }).fill("Spare wheel and jack present.");

    // A mark on the bonnet: the panel comes from where the pointer lands, not a dropdown.
    await markAt(out.getByRole("img", { name: /seen from above/ }), 0.5, 0.2);
    await expect(out.getByText(/Bonnet · Minor/)).toBeVisible();

    await out.getByRole("button", { name: "Record handover" }).click();
    await expect(card(page).getByText("Draft", { exact: true })).toBeVisible();
    await expect(card(page).getByText(/Bonnet · Minor/)).toBeVisible();

    // -- Signed -----------------------------------------------------------
    await sign(page, "Customer's signature");
    await sign(page, "Staff signature");
    await page.getByRole("button", { name: "Sign and close the form" }).click();

    // Asserted on the page's state rather than a message: signing replaces the form with
    // the signed record, so there is nothing left to render a message. The names that
    // were signed, and the report link, are the durable evidence.
    await expect(card(page).getByText("Signed", { exact: true }).first()).toBeVisible();
    await expect(card(page)).toContainText("Omar Haddad");
    // The form is frozen: its signing controls are gone, and only the return's remain.
    await expect(page.getByRole("button", { name: "Sign and close the form" })).toHaveCount(0);

    // -- Back, 5,600 km over ----------------------------------------------
    await page.goto(url);
    const back = section(page, "Return");
    await back.getByRole("spinbutton", { name: "Odometer" }).fill("30600");
    await back.getByRole("combobox", { name: "Fuel" }).selectOption("4");
    await back.getByRole("button", { name: "Record return" }).click();

    await sign(page, "Customer's signature");
    await sign(page, "Staff signature");
    await page.getByRole("button", { name: "Sign and close the form" }).click();
    await expect(card(page).getByText("Signed", { exact: true })).toHaveCount(2);

    // 10,600 km travelled, 5,000 allowed, 5,600 over at AED 0.50 = AED 2,800.
    await expect(card(page)).toContainText("10,600 km");
    await expect(card(page)).toContainText("5,600 km");
    await expect(card(page)).toContainText("2,800.00");
    // It came back on half a tank.
    await expect(card(page)).toContainText("4/8 of a tank lighter");

    // -- The report -------------------------------------------------------
    // Fetched rather than navigated to: a PDF opens in the browser's own viewer, and
    // what matters is that the bytes are a PDF the customer could be handed, in either
    // language. Arabic is generated separately and is the one that breaks.
    const href = await card(page).getByRole("link", { name: "Print the report" }).first().getAttribute("href");
    expect(href).toBeTruthy();

    for (const url of [href as string, `${href}?lang=ar`]) {
      const response = await page.request.get(url);
      expect(response.status(), url).toBe(200);
      expect(response.headers()["content-type"]).toContain("application/pdf");
      const body = await response.body();
      expect(body.subarray(0, 5).toString()).toBe("%PDF-");
      // A report with the diagram, the marks and two signature images in it is never
      // this small; an empty page would be.
      expect(body.byteLength).toBeGreaterThan(5_000);
      // Kept where it can be looked at, on the same reasoning as the screenshot spec: a
      // report that renders without erroring can still be unreadable, and the Arabic one
      // has been wrong twice.
      if (process.env["SHOT_DIR"]) {
        writeFileSync(`${process.env["SHOT_DIR"]}/handover${url.includes("ar") ? "-ar" : ""}.pdf`, body);
      }
    }
  });

  test("a return cannot be written before the car ever went out", async ({ page }) => {
    await signInExpectingSuccess(page, PERSONAS.management);
    await liveContract(page);

    await expect(card(page)).toContainText("Record the handover first");
    await expect(card(page).getByRole("button", { name: "Record return" })).toHaveCount(0);
  });
});
