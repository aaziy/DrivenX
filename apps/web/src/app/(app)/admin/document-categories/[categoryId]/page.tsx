import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { prisma } from "@drivenx/db";

import { seededCategoryKey } from "@/i18n/labels";
import { requirePermission } from "@/lib/auth";

import { deleteDocumentCategory, updateDocumentCategory } from "../actions";
import { CategoryForm } from "../category-form";
import { DeleteCategoryForm } from "./delete-category-form";

async function loadCategory(categoryId: string) {
  return prisma.documentCategory.findUnique({
    where: { id: categoryId },
    include: { _count: { select: { documents: true } } },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}): Promise<Metadata> {
  const category = await loadCategory((await params).categoryId);
  return { title: category ? `${category.label} · DrivenX` : "DrivenX" };
}

export default async function DocumentCategoryPage({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  await requirePermission("settings.manage");
  const { categoryId } = await params;

  const [t, category] = await Promise.all([
    getTranslations("documentCategories"),
    loadCategory(categoryId),
  ]);

  if (!category) notFound();

  const key = seededCategoryKey(category);
  const heading = key ? t(`defaultLabels.${key}`) : category.label;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            <Link href="/admin/document-categories">← {t("title")}</Link>
          </p>
          <h1>{heading}</h1>
          {category.isSystem ? <span className="badge">{t("seeded")}</span> : null}
        </div>
      </header>

      <div className="page-body stack">
        <div className="card">
          <div className="card-body">
            <CategoryForm
              action={updateDocumentCategory.bind(null, category.id)}
              submitLabelKey="save"
              defaults={{
                label: category.label,
                appliesTo: category.appliesTo,
                requiresExpiry: category.requiresExpiry,
                reminders: category.defaultReminderOffsets.join(", "),
              }}
            />
          </div>
        </div>

        {/* A seeded type can be reworded and rescheduled but never removed: documents
            elsewhere in the system are filed under it, and §17 promises editing, not
            deletion. */}
        {!category.isSystem ? (
          <div className="card">
            <div className="card-header">
              <h2>{t("form.delete")}</h2>
            </div>
            <div className="card-body">
              <DeleteCategoryForm action={deleteDocumentCategory.bind(null, category.id)} />
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
