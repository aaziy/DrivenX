/**
 * Notification delivery against a real database (P3-01, P3-02).
 *
 * The rule this exists for is the one the plan calls a P0 concern: a job that is retried
 * must not tell anybody twice. Everything else here is about who gets told at all, which
 * is a permissions question and therefore one where being wrong means mailing a
 * customer's details to somebody who should not have them.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { PERMISSIONS } from "@drivenx/auth/permissions";
import { prisma, withoutAudit } from "@drivenx/db";
import { createConsoleAdapter, type DeliveryAttempt } from "@drivenx/notify";

import { runDeliverNotifications } from "./deliver-notifications";

let serial = 0;
let sink: DeliveryAttempt[];

/** A role holding exactly the permissions named, and a user in it. */
async function userWith(permissions: string[], options: { locale?: "en" | "ar"; email?: string } = {}) {
  serial += 1;
  const email = options.email ?? `person${Date.now()}${serial}@drivenx.ae`;

  return withoutAudit(async () => {
    const role = await prisma.role.create({
      data: { key: `role-${Date.now()}-${serial}`, name: `Role ${serial}` },
    });
    const rows = await prisma.permission.findMany({
      where: { key: { in: permissions } },
      select: { id: true },
    });
    await prisma.rolePermission.createMany({
      data: rows.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
    });

    const user = await prisma.user.create({
      data: {
        email,
        fullName: `Person ${serial}`,
        passwordHash: "x",
        isActive: true,
        locale: options.locale ?? "en",
      },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    return user;
  });
}

async function aNotification(overrides: Record<string, unknown> = {}) {
  serial += 1;
  return prisma.notification.create({
    data: {
      type: "DOCUMENT_EXPIRY",
      severity: "WARNING",
      title: "Emirates ID expires soon",
      body: "Emirates ID for Fatima Al Marri expires on 2026-10-20.",
      entityType: "Document",
      entityId: `doc-${serial}`,
      dueOn: new Date("2026-10-20T00:00:00Z"),
      dedupeKey: `test:${Date.now()}:${serial}`,
      ...overrides,
    },
  });
}

const run = () =>
  runDeliverNotifications({
    adapter: createConsoleAdapter({ sink }),
    baseUrl: "https://drivenx.example",
  });

beforeEach(async () => {
  sink = [];
  // The permission catalogue has to exist for a role to grant anything from it.
  await withoutAudit(async () => {
    const existing = await prisma.permission.count();
    if (existing === 0) {
      await prisma.permission.createMany({
        data: PERMISSIONS.map((permission) => ({
          key: permission.key,
          group: permission.group,
          description: permission.description,
        })),
      });
    }
  });
  // Start from a clean slate: other suites leave notifications behind, and this job
  // deliberately picks up everything recent.
  await prisma.notificationDelivery.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.userRole.deleteMany({});
  await withoutAudit(() => prisma.user.updateMany({ data: { emailNotifications: false } }));
});

describe("who gets told", () => {
  it("emails the people whose permissions entitle them to see it", async () => {
    const entitled = await userWith(["document.view"]);
    await userWith(["payment.view"]);
    await aNotification();

    const result = await run();

    expect(result.sent).toBe(1);
    expect(sink.map((attempt) => attempt.recipient)).toEqual([entitled.email]);
  });

  it("tells only the one person a notification is addressed to", async () => {
    const addressed = await userWith(["document.view"]);
    await userWith(["document.view"]);
    await aNotification({ userId: addressed.id });

    await run();

    expect(sink.map((attempt) => attempt.recipient)).toEqual([addressed.email]);
  });

  it("leaves out anybody who has switched email off", async () => {
    const user = await userWith(["document.view"]);
    await withoutAudit(() =>
      prisma.user.update({ where: { id: user.id }, data: { emailNotifications: false } }),
    );
    await aNotification();

    const result = await run();

    expect(result.sent).toBe(0);
    // Recorded rather than silent: "nobody was emailed" is a question somebody asks.
    expect(result.skipped).toBe(1);
  });

  it("leaves out anybody who can no longer sign in", async () => {
    const user = await userWith(["document.view"]);
    await withoutAudit(() => prisma.user.update({ where: { id: user.id }, data: { isActive: false } }));
    await aNotification();

    // A leaver who still gets fleet alerts is a leaver still being told about the fleet.
    expect((await run()).sent).toBe(0);
  });

  it("writes to each person in their own language", async () => {
    await userWith(["document.view"], { locale: "ar" });
    await aNotification();

    await run();

    expect(sink).toHaveLength(1);
    expect(sink[0]?.locale).toBe("ar");
    expect(sink[0]?.message.subject.startsWith("درِفن إكس:")).toBe(true);
  });

  it("links to the record the notification is about", async () => {
    await userWith(["document.view"]);
    const notification = await aNotification();

    await run();

    expect(sink[0]?.message.text).toContain(`https://drivenx.example/documents/${notification.entityId}`);
  });
});

describe("running it twice", () => {
  it("tells nobody twice, however many times the job runs", async () => {
    await userWith(["document.view"]);
    await aNotification();

    const first = await run();
    const second = await run();
    const third = await run();

    expect(first.sent).toBe(1);
    // The delivery row was claimed on the first run, so there is nothing left to claim.
    expect(second.sent).toBe(0);
    expect(third.sent).toBe(0);
    expect(sink).toHaveLength(1);
  });

  it("keeps one delivery row per person per notification", async () => {
    await userWith(["document.view"]);
    const notification = await aNotification();

    await run();
    await run();

    const deliveries = await prisma.notificationDelivery.findMany({
      where: { notificationId: notification.id },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ status: "SENT", attempts: 1 });
    expect(deliveries[0]?.sentAt).toBeInstanceOf(Date);
  });
});

describe("when sending fails", () => {
  const failing = (retryable: boolean) => ({
    channel: "EMAIL" as const,
    isConfigured: () => true,
    send: async () => ({ ok: false as const, error: "provider said no", retryable }),
  });

  it("leaves a retryable failure to be picked up next time", async () => {
    await userWith(["document.view"]);
    const notification = await aNotification();

    const result = await runDeliverNotifications({ adapter: failing(true), baseUrl: "https://x" });
    expect(result.failed).toBe(1);

    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { notificationId: notification.id },
    });
    expect(delivery).toMatchObject({ status: "PENDING", attempts: 1, lastError: "provider said no" });

    // And the next run does pick it up, this time with a working adapter.
    const second = await run();
    expect(second.sent).toBe(1);
  });

  it("closes a permanent failure rather than retrying for ever", async () => {
    await userWith(["document.view"]);
    const notification = await aNotification();

    await runDeliverNotifications({ adapter: failing(false), baseUrl: "https://x" });

    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { notificationId: notification.id },
    });
    expect(delivery.status).toBe("FAILED");

    // A bad address is not worth trying again: the next run leaves it alone.
    const second = await run();
    expect(second.sent).toBe(0);
    expect(sink).toHaveLength(0);
  });
});

describe("one message per person (P3-04)", () => {
  it("gathers everything somebody is owed into a single email", async () => {
    await userWith(["document.view"]);
    await aNotification({ body: "Emirates ID for Fatima expires on 2026-10-20." });
    await aNotification({ body: "Mulkiya for VEH-00012 expires on 2026-11-02." });
    await aNotification({ body: "Passport for Omar expires on 2026-12-01." });

    const result = await run();

    // Three things waiting, one email. Three emails on one morning is how an alert
    // system earns a filter rule.
    expect(result.considered).toBe(3);
    expect(sink).toHaveLength(1);
    expect(result.sent).toBe(1);

    const text = sink[0]?.message.text ?? "";
    expect(text).toContain("Emirates ID for Fatima");
    expect(text).toContain("Mulkiya for VEH-00012");
    expect(text).toContain("Passport for Omar");
    expect(sink[0]?.message.subject).toBe("DrivenX: 3 things need attention");
  });

  it("still writes a plain single alert when only one thing is waiting", async () => {
    await userWith(["document.view"]);
    await aNotification();

    await run();

    // A digest of one is a worse email than the alert it wraps.
    expect(sink[0]?.message.subject).toBe("DrivenX: Emirates ID expires soon");
  });

  it("marks every notification in the batch delivered, so none is sent twice", async () => {
    await userWith(["document.view"]);
    await aNotification({ body: "One." });
    await aNotification({ body: "Two." });

    await run();
    const second = await run();

    expect(second.sent).toBe(0);
    expect(sink).toHaveLength(1);
    const deliveries = await prisma.notificationDelivery.findMany();
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((delivery) => delivery.status === "SENT")).toBe(true);
  });

  it("gives each person only what they are entitled to", async () => {
    const documents = await userWith(["document.view"]);
    const payments = await userWith(["payment.view"]);
    await aNotification({ body: "A document expires." });
    await aNotification({ type: "PAYMENT_OVERDUE", body: "An instalment is overdue." });

    await run();

    const byRecipient = new Map(sink.map((attempt) => [attempt.recipient, attempt.message.text]));
    expect(byRecipient.get(documents.email)).toContain("A document expires.");
    expect(byRecipient.get(documents.email)).not.toContain("overdue");
    expect(byRecipient.get(payments.email)).toContain("An instalment is overdue.");
    expect(byRecipient.get(payments.email)).not.toContain("A document expires.");
  });

  it("says nothing about what has already been dealt with on screen", async () => {
    await userWith(["document.view"]);
    const handled = await aNotification({ body: "Already sorted." });
    await aNotification({ body: "Still waiting." });
    await prisma.notification.update({ where: { id: handled.id }, data: { readAt: new Date() } });

    await run();

    // Read clears it for everybody, so emailing about it now is the noise that teaches
    // people to ignore the next one.
    expect(sink[0]?.message.text).not.toContain("Already sorted.");
    expect(sink[0]?.message.text).toContain("Still waiting.");
  });

  it("fails a whole batch together, and retries it together", async () => {
    await userWith(["document.view"]);
    await aNotification({ body: "One." });
    await aNotification({ body: "Two." });

    const failed = await runDeliverNotifications({
      adapter: {
        channel: "EMAIL",
        isConfigured: () => true,
        send: async () => ({ ok: false as const, error: "greylisted", retryable: true }),
      },
      baseUrl: "https://x",
    });
    expect(failed.failed).toBe(1);

    const pending = await prisma.notificationDelivery.findMany();
    expect(pending).toHaveLength(2);
    expect(pending.every((delivery) => delivery.status === "PENDING")).toBe(true);

    // Both come back on the next run, in one message, rather than one being stranded.
    const retried = await run();
    expect(retried.sent).toBe(1);
    expect(sink[0]?.message.text).toContain("One.");
    expect(sink[0]?.message.text).toContain("Two.");
  });
});
