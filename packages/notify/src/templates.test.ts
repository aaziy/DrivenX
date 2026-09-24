import { describe, expect, it } from "vitest";

import { NOTIFICATION_TYPES } from "@drivenx/core";

import { hasTemplate, renderNotification, templateCoverage } from "./templates";

describe("email templates", () => {
  it("covers every notification type in both languages", () => {
    // A type added to the enum without a template arrives as a blank subject in
    // somebody's inbox. This is what stops that reaching a customer.
    expect(templateCoverage()).toEqual([]);
    for (const type of NOTIFICATION_TYPES) {
      expect(hasTemplate("en", type), type).toBe(true);
      expect(hasTemplate("ar", type), type).toBe(true);
    }
  });

  it("names the thing in the subject, so an inbox is readable", () => {
    const rendered = renderNotification({
      type: "DOCUMENT_EXPIRY",
      locale: "en",
      title: "Emirates ID expires soon",
      body: "Emirates ID for Fatima Al Marri expires on 2026-10-20.",
    });

    expect(rendered.subject).toBe("DrivenX: Emirates ID expires soon");
    expect(rendered.text).toContain("Emirates ID for Fatima Al Marri");
  });

  it("writes in the reader's language", () => {
    const arabic = renderNotification({
      type: "PAYMENT_OVERDUE",
      locale: "ar",
      title: "Payment overdue",
      body: "INV-000123 is overdue.",
    });

    expect(arabic.subject.startsWith("درِفن إكس:")).toBe(true);
    expect(arabic.text).toContain("فاتت دفعة دون سداد");
    // The specifics stay as the worker composed them; only the wrapper is translated.
    expect(arabic.text).toContain("INV-000123");
  });

  it("includes the link when there is somewhere to send the reader", () => {
    const rendered = renderNotification({
      type: "MAINTENANCE_DUE",
      locale: "en",
      title: "Service due",
      body: "VEH-00012 is due for service.",
      url: "https://drivenx.example/vehicles/abc",
    });

    expect(rendered.text).toContain("https://drivenx.example/vehicles/abc");
  });

  it("leaves the link out rather than printing an empty one", () => {
    const rendered = renderNotification({
      type: "MAINTENANCE_DUE",
      locale: "en",
      title: "Service due",
      body: "VEH-00012 is due for service.",
    });

    expect(rendered.text).not.toContain("http");
    expect(rendered.text.trim().endsWith("service.")).toBe(true);
  });

  it("carries the due date when there is one", () => {
    const rendered = renderNotification({
      type: "CONTRACT_EXPIRY",
      locale: "en",
      title: "Contract ending",
      body: "CON-00042 ends soon.",
      dueOn: "2026-12-31",
    });

    expect(rendered.text).toContain("2026-12-31");
  });
});
