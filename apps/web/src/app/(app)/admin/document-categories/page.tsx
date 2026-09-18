import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { prisma } from "@drivenx/db";

import { DataTable, type Column } from "@/components/data-table";
import { seededCategoryKey } from "@/i18n/labels";
import { requirePermission } from "@/lib/auth";

import { createDocumentCategory } from "./actions";
import { CategoryForm } from "./category-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("documentCategories");
  return { title: `${t("title")} · DrivenX` };
}

type CategoryRow = {
  id: string;
  key: string;
  label: string;
  isSystem: boolean;
  appliesTo: string[];
  requiresExpiry: boolean;
  defaultReminderOffsets: number[];
  _count: { documents: number };
};

export default async function DocumentCategoriesPage() {
  await requirePermission("settings.manage");

  const [t, tOwners, categories] = await Promise.all([
    getTranslations("documentCategories"),
    getTranslations("documentCategories.owners"),
    prisma.documentCategory.findMany({
      orderBy: [{ isSystem: "desc" }, { label: "asc" }],
      select: {
        id: true,
        key: true,
        label: true,
        isSystem: true,
        appliesTo: true,
        requiresExpiry: true,
        defaultReminderOffsets: true,
        _count: { select: { documents: true } },
      },
    }),
  ]);

  const columns: Column<CategoryRow>[] = [
    {
      key: "label",
      header: t("columns.label"),
      render: (category) => {
        const key = seededCategoryKey(category);

        return (
          <>
            <div style={{ fontWeight: 560 }}>
              {key ? t(`defaultLabels.${key}`) : category.label}
            </div>
            {category.isSystem ? (
              <span className="badge" style={{ marginBlockStart: 4 }}>
                {t("seeded")}
              </span>
            ) : null}
          </>
        );
      },
    },
    {
      key: "appliesTo",
      header: t("columns.appliesTo"),
      render: (category) => (
        <span className="row" style={{ flexWrap: "wrap", gap: 5 }}>
          {category.appliesTo.map((owner) => (
            <span key={owner} className="badge">
              {tOwners(owner)}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: "expiry",
      header: t("columns.expiry"),
      render: (category) =>
        category.requiresExpiry ? (
          <span className="badge badge-success">{t("expiryRequired")}</span>
        ) : (
          <span className="muted">{t("expiryOptional")}</span>
        ),
    },
    {
      key: "reminders",
      header: t("columns.reminders"),
      render: (category) =>
        category.defaultReminderOffsets.length === 0 ? (
          <span className="muted">{t("remindersNone")}</span>
        ) : (
          <bdi>{t("remindersDays", { days: category.defaultReminderOffsets.join(", ") })}</bdi>
        ),
    },
    {
      key: "inUse",
      header: t("columns.inUse"),
      numeric: true,
      render: (category) => category._count.documents,
    },
    {
      key: "actions",
      header: "",
      render: (category) => (
        <Link href={`/admin/document-categories/${category.id}`} className="btn-link">
          {t("edit")}
        </Link>
      ),
    },
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("title")}</h1>
          <p className="page-subtitle">{t("subtitle")}</p>
        </div>
      </header>

      <div className="page-body stack">
        <div className="card">
          <div className="card-header">
            <h2>{t("addTitle")}</h2>
          </div>
          <div className="card-body">
            <CategoryForm action={createDocumentCategory} />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>{t("allTitle")}</h2>
          </div>
          <DataTable
            rows={categories}
            columns={columns}
            rowKey={(category) => category.id}
            emptyTitle={t("emptyTitle")}
          />
        </div>
      </div>
    </>
  );
}
