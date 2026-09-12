"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { hashPassword, validatePassword } from "@drivenx/auth/password";
import { prisma } from "@drivenx/db";
import { UserFacingError } from "@drivenx/logger";

import { asActor, requirePermission } from "@/lib/auth";
import { requestLogger, toUserMessage } from "@/lib/log";

export interface UserFormState {
  error?: string;
  success?: string;
}

const CreateUserSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the person's full name."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string(),
  roleId: z.string().min(1, "Choose a role."),
});

export async function createUser(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const principal = await requirePermission("user.manage");

  const parsed = CreateUserSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    roleId: formData.get("roleId"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details you entered." };
  }

  const { fullName, email, password, roleId } = parsed.data;

  const policy = validatePassword(password);
  if (!policy.valid) {
    return { error: policy.errors.join(" ") };
  }

  if (await prisma.user.findUnique({ where: { email } })) {
    return { error: "A user with that email already exists." };
  }

  if (!(await prisma.role.findUnique({ where: { id: roleId } }))) {
    return { error: "That role no longer exists." };
  }

  try {
    await asActor(principal, async () => {
      await prisma.user.create({
        data: {
          email,
          fullName,
          passwordHash: await hashPassword(password),
          roles: { create: { roleId } },
        },
      });
    });
  } catch (error) {
    // The checks above are not a guarantee: two administrators submitting the same
    // email at once both pass them, and the loser hits a unique constraint. The user
    // sees a reference code, not the constraint text.
    return { error: await toUserMessage("createUser", error) };
  }

  revalidatePath("/admin/users");
  return { success: `Created ${fullName}.` };
}

export async function setUserActive(userId: string, isActive: boolean): Promise<void> {
  const principal = await requirePermission("user.manage");

  // Locking yourself out of the only Super Admin account is unrecoverable without
  // database access, so it is refused rather than merely discouraged.
  if (userId === principal.id) {
    throw new UserFacingError("You cannot deactivate your own account.");
  }

  await asActor(principal, async () => {
    await prisma.user.update({ where: { id: userId }, data: { isActive } });
  });

  const log = await requestLogger();
  log.info(isActive ? "user reactivated" : "user deactivated", {
    targetUserId: userId,
    actorId: principal.id,
  });

  revalidatePath("/admin/users");
}
