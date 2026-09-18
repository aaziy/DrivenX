import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { daysUntilExpiry, expiryStatus, type ExpiryStatus } from "@drivenx/core";
import { prisma, type DocumentOwnerType } from "@drivenx/db";

import { SubmitButton } from "@/components/form";
import { seededCategoryKey } from "@/i18n/labels";
import { maxUploadBytes } from "@/lib/storage";

import { deleteDocument, uploadDocument } from "./actions";
import { DocumentUploadForm } from "./document-upload-form";

/**
 * The documents attached to one record.
 *
 * Shared by the customer and supplier pages, and by vehicles and contracts when they
 * arrive: the owner is polymorphic precisely so that there is one document feature
 * rather than one per record type (§3.3).
 */
export async function DocumentsCard({
  ownerType,
  ownerId,
  canUpload,
  canDelete,
}: {
  ownerType: DocumentOwnerType;
  ownerId: string;
  canUpload: boolean;
  canDelete: boolean;
}) {
  const now = new Date();

  const [t, tCat, format, documents, categories] = await Promise.all([
    getTranslations("documents"),
    getTranslations("documentCategories"),
    getFormatter(),
    prisma.document.findMany({
      where: { ownerType, ownerId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { category: true },
    }),
    prisma.documentCategory.findMany({
      where: { appliesTo: { has: ownerType } },
      orderBy: { label: "asc" },
    }),
  ]);

  /** Seeded types read in the reader's language; a type the client renamed keeps theirs. */
  const categoryLabel = (category: { key: string; label: string; isSystem: boolean }) => {
    const key = seededCategoryKey(category);
    return key ? tCat(`defaultLabels.${key}`) : category.label;
  };

  const tone: Record<ExpiryStatus, string> = {
    valid: "badge-success",
    expiring: "badge-warning",
    expired: "badge-danger",
    no_expiry: "",
  };

  /** "in 12 days" / "today" / "3 days ago" — the number people actually act on. */
  const expiryRelative = (expiryDate: Date | null) => {
    if (!expiryDate) return t("expiry.none");
    const days = daysUntilExpiry(expiryDate, now);
    if (days === 0) return t("expiry.today");
    return days > 0 ? t("expiry.inDays", { days }) : t("expiry.agoDays", { days: -days });
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>{t("cardTitle")}</h2>
      </div>

      {canUpload && categories.length > 0 ? (
        <div className="card-body">
          <DocumentUploadForm
            action={uploadDocument.bind(null, ownerType, ownerId)}
            categories={categories.map((category) => ({
              id: category.id,
              label: categoryLabel(category),
              requiresExpiry: category.requiresExpiry,
            }))}
            limitMb={Math.floor(maxUploadBytes() / (1024 * 1024))}
          />
        </div>
      ) : null}

      {documents.length === 0 ? (
        <div className="card-body">
          <p className="muted">{t("empty")}</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="data">
            <thead>
              <tr>
                <th>{t("columns.document")}</th>
                <th>{t("columns.number")}</th>
                <th>{t("columns.expiry")}</th>
                <th>{t("columns.status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => {
                // A superseded document keeps its dates, so asking the expiry engine
                // would report it as expiring and contradict the row's own badge.
                const replaced = document.status === "REPLACED";
                const status = replaced
                  ? null
                  : expiryStatus(document.expiryDate, document.reminderOffsets, now);

                return (
                  <tr key={document.id}>
                    <td>
                      <div style={{ fontWeight: 560 }}>{categoryLabel(document.category)}</div>
                      <div className="muted" style={{ fontSize: 12.5 }}>
                        <bdi>{document.fileName}</bdi>
                      </div>
                    </td>
                    <td>
                      {document.documentNumber ? (
                        <bdi>{document.documentNumber}</bdi>
                      ) : (
                        <span className="muted">{t("expiry.none")}</span>
                      )}
                    </td>
                    <td>
                      {document.expiryDate ? (
                        <>
                          <time dateTime={document.expiryDate.toISOString()}>
                            {format.dateTime(document.expiryDate, { dateStyle: "medium" })}
                          </time>
                          <div className="muted" style={{ fontSize: 12.5 }}>
                            {expiryRelative(document.expiryDate)}
                          </div>
                        </>
                      ) : (
                        <span className="muted">{t("expiry.none")}</span>
                      )}
                    </td>
                    <td>
                      {status === null ? (
                        <span className="badge">{t("status.replaced")}</span>
                      ) : (
                        <span className={`badge ${tone[status]}`.trim()}>
                          {t(`status.${status}`)}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <Link
                          className="btn-secondary"
                          href={`/documents/${document.id}/download`}
                          prefetch={false}
                        >
                          {t("actions.download")}
                        </Link>
                        {canDelete ? (
                          <form action={deleteDocument.bind(null, document.id)}>
                            <SubmitButton variant="secondary" pendingLabel={t("actions.deleting")}>
                              {t("actions.delete")}
                            </SubmitButton>
                          </form>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
