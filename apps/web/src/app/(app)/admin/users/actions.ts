"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
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

export async function createUser(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const principal = await requirePermission("user.manage");

  const [t, tc, tp, tu] = await Promise.all([
    getTranslations("users.errors"),
    getTranslations("common"),
    getTranslations("password"),
    getTranslations("users"),
  ]);

  // Built per request so validation messages come out in the language on screen.
  const CreateUserSchema = z.object({
    fullName: z.string().trim().min(2, t("fullName")),
    email: z.string().trim().toLowerCase().email(t("email")),
    password: z.string(),
    roleId: z.string().min(1, t("role")),
  });

  const parsed = CreateUserSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    roleId: formData.get("roleId"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? tc("checkDetails") };
  }

  const { fullName, email, password, roleId } = parsed.data;

  const policy = validatePassword(password);
  if (!policy.valid) {
    // Codes rather than the English sentences, so the rules read in the chosen language.
    return { error: policy.issues.map((issue) => tp(issue.code, issue.params)).join(" ") };
  }

  if (await prisma.user.findUnique({ where: { email } })) {
    return { error: t("emailTaken") };
  }

  if (!(await prisma.role.findUnique({ where: { id: roleId } }))) {
    return { error: t("roleGone") };
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
  return { success: tu("created", { name: fullName }) };
}

export async function setUserActive(userId: string, isActive: boolean): Promise<void> {
  const principal = await requirePermission("user.manage");

  // Locking yourself out of the only Super Admin account is unrecoverable without
  // database access, so it is refused rather than merely discouraged.
  if (userId === principal.id) {
    const t = await getTranslations("users.errors");
    throw new UserFacingError(t("selfDeactivate"));
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
