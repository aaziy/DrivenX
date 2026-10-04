/**
 * Changing and resetting a password, against a real database.
 *
 * Until these existed, a password could never change after an account was created: not
 * by its owner, not by an administrator. The rules worth pinning are the ones a change
 * exists to enforce - that the old password stops working, and that every session opened
 * with it ends.
 */

import { prisma } from "@drivenx/db";
import { describe, expect, it } from "vitest";

import { hashPassword } from "./password";
import { authenticate, changeOwnPassword, loadPrincipal, resetPasswordAsAdmin } from "./session";

const OLD = "DrivenX2026Fleet";
const NEW = "Kerbside2026Return";

async function aUser(email = `change${Date.now()}@drivenx.ae`) {
  return prisma.user.create({
    data: { email, fullName: "Change Test", passwordHash: await hashPassword(OLD) },
  });
}

describe("changing your own password", () => {
  it("works with the right current password, and the old one stops working", async () => {
    const user = await aUser();

    expect(await changeOwnPassword(user.id, OLD, NEW)).toEqual({ ok: true });

    expect((await authenticate(user.email, NEW)).ok).toBe(true);
    expect((await authenticate(user.email, OLD)).ok).toBe(false);
  });

  it("refuses without the current password, even from a signed-in session", async () => {
    // A session left open on a shared computer must not be enough to take the account.
    const user = await aUser();
    expect(await changeOwnPassword(user.id, "NotMyPassword1", NEW)).toEqual({
      ok: false,
      reason: "wrong_current",
    });
    expect((await authenticate(user.email, OLD)).ok).toBe(true);
  });

  it("refuses a password the policy would refuse anyway", async () => {
    const user = await aUser();
    const result = await changeOwnPassword(user.id, OLD, "short");
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "policy") {
      expect(result.issues.map((issue) => issue.code)).toContain("tooShort");
    } else {
      throw new Error(`expected a policy refusal, got ${JSON.stringify(result)}`);
    }
  });

  it("refuses a new password identical to the old one", async () => {
    const user = await aUser();
    expect(await changeOwnPassword(user.id, OLD, OLD)).toEqual({ ok: false, reason: "same_as_current" });
  });

  it("clears a lockout, because a new password is a fresh start", async () => {
    const user = await aUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 5, lockedUntil: new Date(Date.now() + 15 * 60_000) },
    });

    await resetPasswordAsAdmin(user.id, NEW);
    expect((await authenticate(user.email, NEW)).ok).toBe(true);
  });
});

describe("what a change does to sessions that already exist", () => {
  it("ends a session that began before the change", async () => {
    const user = await aUser();
    // A session opened after the account was created - its password is set at creation,
    // so anything older than that is already refused - and a change an hour later.
    const sessionStarted = new Date(Date.now() + 1_000);
    const changedAt = new Date(Date.now() + 60 * 60_000);

    expect(await loadPrincipal(user.id, { sessionIssuedAt: sessionStarted })).not.toBeNull();

    await changeOwnPassword(user.id, OLD, NEW, changedAt);

    // Whoever is holding that session - its owner, or somebody who had the old password -
    // is now signed out.
    expect(await loadPrincipal(user.id, { sessionIssuedAt: sessionStarted })).toBeNull();
  });

  it("keeps a session that began at or after the change", async () => {
    const user = await aUser();
    const second = Math.floor(Date.now() / 1000) * 1000 + 60 * 60_000;
    await changeOwnPassword(user.id, OLD, NEW, new Date(second + 400));

    // The session the change itself starts begins in the same second, and a session token
    // only records whole seconds.
    expect(await loadPrincipal(user.id, { sessionIssuedAt: new Date(second) })).not.toBeNull();
    expect(await loadPrincipal(user.id, { sessionIssuedAt: new Date(second + 60_000) })).not.toBeNull();
    // A second earlier is a session from before the change.
    expect(await loadPrincipal(user.id, { sessionIssuedAt: new Date(second - 1_000) })).toBeNull();
  });

  it("is ended by an administrator's reset too", async () => {
    const user = await aUser();
    const before = new Date(Date.now() - 60_000);
    await resetPasswordAsAdmin(user.id, NEW);

    expect(await loadPrincipal(user.id, { sessionIssuedAt: before })).toBeNull();
  });

  it("leaves loading a person without a session time unchanged", async () => {
    // Callers that have no session - authenticate, jobs - are unaffected.
    const user = await aUser();
    await resetPasswordAsAdmin(user.id, NEW);
    expect(await loadPrincipal(user.id)).not.toBeNull();
  });
});

describe("an administrator resetting a password", () => {
  it("sets it without needing the old one", async () => {
    const user = await aUser();
    expect(await resetPasswordAsAdmin(user.id, NEW)).toEqual({ ok: true });
    expect((await authenticate(user.email, NEW)).ok).toBe(true);
  });

  it("still holds the new password to the policy", async () => {
    const user = await aUser();
    expect((await resetPasswordAsAdmin(user.id, "password")).ok).toBe(false);
  });
});
