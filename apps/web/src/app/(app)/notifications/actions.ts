"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@drivenx/db";

import { requireUser } from "@/lib/auth";
import { visibilityWhere, visibleTypes } from "@/lib/notifications";

/**
 * Marking a notification read marks it read for everyone who can see it.
 *
 * There is one `readAt` on a shared row, so this is a shared work queue rather than a
 * personal inbox: "somebody has dealt with this" is the useful signal for a team of a
 * few people chasing the same expiring documents. If the client wants per-person read
 * state, that is a new table, not a tweak here.
 *
 * Deliberately not `requirePermission`: the right to mark a notification read is the
 * right to see it, which is decided per type in lib/notifications.ts.
 */
export async function markNotificationRead(notificationId: string): Promise<void> {
  const principal = await requireUser();
  if (visibleTypes(principal).length === 0) return;

  // Scoped by visibility, so an id guessed from another part of the system does nothing.
  await prisma.notification.updateMany({
    where: { ...visibilityWhere(principal), id: notificationId, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath("/notifications");
}

export async function markAllNotificationsRead(): Promise<void> {
  const principal = await requireUser();
  if (visibleTypes(principal).length === 0) return;

  await prisma.notification.updateMany({
    where: { ...visibilityWhere(principal), readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath("/notifications");
}

export interface NotificationPreferenceState {
  error?: string;
}

/**
 * Turn email alerts on or off for the person asking (P3-01).
 *
 * Their own setting only: there is no user id in the form, because being able to change
 * somebody else's notification settings is not something this screen should grant.
 */
export async function setEmailNotificationsAction(
  _previous: NotificationPreferenceState,
  formData: FormData,
): Promise<NotificationPreferenceState> {
  const principal = await requireUser();
  const wanted = String(formData.get("emailNotifications") ?? "") === "on";

  await prisma.user.update({
    where: { id: principal.id },
    data: { emailNotifications: wanted },
  });

  revalidatePath("/notifications");
  return {};
}
