"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { expiryStatus } from "@drivenx/core";
import { prisma, type DocumentOwnerType, type DocumentStatus } from "@drivenx/db";
import { buildObjectKey, validateUpload } from "@drivenx/storage";

import { asActor, requirePermission } from "@/lib/auth";
import { requestLogger, toUserMessage } from "@/lib/log";
import { maxUploadBytes, storage } from "@/lib/storage";

export interface DocumentFormState {
  error?: string;
  success?: string;
}

/** Where a document of this owner type is shown, so the right page is revalidated. */
const OWNER_PATH: Record<DocumentOwnerType, string> = {
  CUSTOMER: "customers",
  SUPPLIER: "suppliers",
  VEHICLE: "vehicles",
  CONTRACT: "contracts",
  INSURANCE_POLICY: "insurance",
};

/** The owner must exist before a document is hung off it — see the schema's note on
 *  the polymorphic owner columns, which carry no foreign key to enforce this. */
async function ownerExists(ownerType: DocumentOwnerType, ownerId: string): Promise<boolean> {
  if (ownerType === "CUSTOMER") {
    return (await prisma.customer.count({ where: { id: ownerId, deletedAt: null } })) > 0;
  }
  if (ownerType === "SUPPLIER") {
    return (await prisma.supplier.count({ where: { id: ownerId, deletedAt: null } })) > 0;
  }
  // Vehicles, contracts and policies arrive in later milestones.
  return false;
}

function toDocumentStatus(expiryDate: Date | null, offsets: number[], now: Date): DocumentStatus {
  const status = expiryStatus(expiryDate, offsets, now);
  if (status === "expired") return "EXPIRED";
  if (status === "expiring") return "EXPIRING";
  // A document with no expiry is simply valid; it is never chased.
  return "VALID";
}

export async function uploadDocument(
  ownerType: DocumentOwnerType,
  ownerId: string,
  _previous: DocumentFormState,
  formData: FormData,
): Promise<DocumentFormState> {
  const principal = await requirePermission("document.upload");

  const [t, tc, tu] = await Promise.all([
    getTranslations("documents"),
    getTranslations("common"),
    getTranslations("upload"),
  ]);

  const fields = z
    .object({
      categoryId: z.string().min(1, t("errors.category")),
      documentNumber: z
        .string()
        .trim()
        .transform((value) => (value === "" ? null : value)),
      issueDate: z
        .union([z.literal(""), z.coerce.date()])
        .transform((value) => (value === "" ? null : value)),
      expiryDate: z
        .union([z.literal(""), z.coerce.date()])
        .transform((value) => (value === "" ? null : value)),
      notes: z
        .string()
        .trim()
        .transform((value) => (value === "" ? null : value)),
    })
    .safeParse({
      categoryId: formData.get("categoryId") ?? "",
      documentNumber: formData.get("documentNumber") ?? "",
      issueDate: formData.get("issueDate") ?? "",
      expiryDate: formData.get("expiryDate") ?? "",
      notes: formData.get("notes") ?? "",
    });

  if (!fields.success) {
    return { error: fields.error.issues[0]?.message ?? tc("checkDetails") };
  }

  if (!(await ownerExists(ownerType, ownerId))) {
    return { error: t("errors.ownerNotFound") };
  }

  const category = await prisma.documentCategory.findUnique({
    where: { id: fields.data.categoryId },
  });
  if (!category) {
    return { error: t("errors.categoryGone") };
  }
  if (category.requiresExpiry && !fields.data.expiryDate) {
    // Without a date this document can never be chased, which is the entire point of
    // recording it.
    return { error: t("errors.expiryRequired") };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: t("errors.file") };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateUpload(
    { fileName: file.name, declaredMimeType: file.type, bytes },
    { maxBytes: maxUploadBytes() },
  );

  if (!validation.valid) {
    // Codes rather than the English sentences, so a rejection reads in the chosen
    // language — the moment someone most needs to understand what went wrong.
    return { error: validation.issues.map((issue) => tu(issue.code, issue.params)).join(" ") };
  }

  const key = buildObjectKey(ownerType, ownerId, validation.mimeType);

  try {
    await storage().put({
      key,
      bytes,
      mimeType: validation.mimeType,
      fileName: validation.fileName,
    });
  } catch (error) {
    // Storage unreachable or misconfigured. Staff get a message they can act on and a
    // form that still holds what they typed, rather than an error boundary.
    return { error: await toUserMessage("uploadDocument", error) };
  }

  try {
    await asActor(principal, async () => {
      await prisma.document.create({
        data: {
          ownerType,
          ownerId,
          categoryId: category.id,
          documentNumber: fields.data.documentNumber,
          issueDate: fields.data.issueDate,
          expiryDate: fields.data.expiryDate,
          fileKey: key,
          fileName: validation.fileName,
          mimeType: validation.mimeType,
          sizeBytes: validation.sizeBytes,
          reminderOffsets: category.defaultReminderOffsets,
          status: toDocumentStatus(
            fields.data.expiryDate,
            category.defaultReminderOffsets,
            new Date(),
          ),
          notes: fields.data.notes,
          uploadedById: principal.id,
        },
      });
    });
  } catch (error) {
    // The bytes are already in storage. Without this the object is orphaned: paid for,
    // backed up, containing someone's passport, and referenced by nothing.
    await storage()
      .delete(key)
      .catch(() => undefined);
    return { error: await toUserMessage("uploadDocument", error) };
  }

  revalidatePath(`/${OWNER_PATH[ownerType]}/${ownerId}`);
  return { success: t("uploaded", { name: validation.fileName }) };
}

/**
 * Soft delete.
 *
 * The row is hidden and the stored object is left in place: a document that was attached
 * to a contract is part of why that contract was approved, and the audit trail should not
 * point at bytes that no longer exist. Purging belongs in a retention job, run
 * deliberately, not as a side effect of somebody tidying a list.
 */
export async function deleteDocument(documentId: string): Promise<void> {
  const principal = await requirePermission("document.delete");

  const document = await prisma.document.findFirst({
    where: { id: documentId, deletedAt: null },
    select: { id: true, ownerType: true, ownerId: true },
  });
  if (!document) return;

  await asActor(principal, async () => {
    await prisma.document.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });
  });

  const log = await requestLogger();
  log.info("document removed", { documentId, actorId: principal.id });

  revalidatePath(`/${OWNER_PATH[document.ownerType]}/${document.ownerId}`);
}
