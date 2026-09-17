import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { prisma } from "@drivenx/db";

import { DataTable, type Column } from "@/components/data-table";
import { requirePermission } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("audit");
  return { title: `${t("title")} · DrivenX` };
}

const PAGE_SIZE = 50;

type AuditRow = {
  id: string;
  createdAt: Date;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  actor: { fullName: string; email: string } | null;
};

const ACTION_TONE: Record<string, string> = {
  CREATE: "badge badge-success",
  UPDATE: "badge badge-warning",
  DELETE: "badge badge-danger",
  LOGIN: "badge",
  LOGIN_FAILED: "badge badge-danger",
  LOGOUT: "badge",
  TRANSITION: "badge badge-warning",
  PERMISSION_CHANGE: "badge badge-warning",
};

/** Render a field-level diff compactly: `field: old → new`. */
function ChangeSummary({
  before,
  after,
  fieldsLabel,
}: {
  before: unknown;
  after: unknown;
  fieldsLabel: (count: number) => string;
}) {
  const beforeRecord = (before ?? {}) as Record<string, unknown>;
  const afterRecord = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])];

  if (keys.length === 0) return <span className="muted">—</span>;

  // Whole-record snapshots (create/delete) would flood the column; summarise instead.
  if (keys.length > 4) {
    return <span className="muted">{fieldsLabel(keys.length)}</span>;
  }

  // Field names and values are code, and stay left-to-right in any language.
  return (
    <span className="mono" dir="ltr">
      {keys.map((key) => (
        <span key={key} style={{ display: "block" }}>
          {key}
          {key in beforeRecord && key in afterRecord ? (
            <>
              : <span className="muted">{JSON.stringify(beforeRecord[key])}</span> →{" "}
              {JSON.stringify(afterRecord[key])}
            </>
          ) : null}
        </span>
      ))}
    </span>
  );
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requirePermission("audit.view");

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const [t, tc, format, entries, total] = await Promise.all([
    getTranslations("audit"),
    getTranslations("common"),
    getFormatter(),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      select: {
        id: true,
        createdAt: true,
        action: true,
        entityType: true,
        entityId: true,
        before: true,
        after: true,
        ipAddress: true,
        actor: { select: { fullName: true, email: true } },
      },
    }),
    prisma.auditLog.count(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: Column<AuditRow>[] = [
    {
      key: "when",
      header: t("columns.when"),
      render: (entry) => (
        <time dateTime={entry.createdAt.toISOString()} className="mono">
          {format.dateTime(entry.createdAt, { dateStyle: "short", timeStyle: "medium" })}
        </time>
      ),
    },
    {
      key: "who",
      header: t("columns.who"),
      render: (entry) =>
        entry.actor ? (
          <>
            <div>{entry.actor.fullName}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              <bdi>{entry.ipAddress ?? ""}</bdi>
            </div>
          </>
        ) : (
          <span className="muted">{tc("system")}</span>
        ),
    },
    {
      key: "action",
      header: t("columns.action"),
      render: (entry) => (
        <span className={ACTION_TONE[entry.action] ?? "badge"}>
          {t.has(`actions.${entry.action}`) ? t(`actions.${entry.action}`) : entry.action}
        </span>
      ),
    },
    {
      key: "entity",
      header: t("columns.record"),
      render: (entry) => (
        <>
          <div>
            {t.has(`entities.${entry.entityType}`)
              ? t(`entities.${entry.entityType}`)
              : entry.entityType}
          </div>
          <div className="muted mono" style={{ fontSize: 11 }}>
            <bdi>
              {entry.entityId.length > 34 ? `${entry.entityId.slice(0, 34)}…` : entry.entityId}
            </bdi>
          </div>
        </>
      ),
    },
    {
      key: "changes",
      header: t("columns.changes"),
      render: (entry) => (
        <ChangeSummary
          before={entry.before}
          after={entry.after}
          fieldsLabel={(count) => t("fields", { count })}
        />
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

      <div className="page-body">
        <div className="card">
          <div className="card-header">
            <h2>{t("recent")}</h2>
            <span className="muted">{t("summary", { total, page, pages: totalPages })}</span>
          </div>

          <DataTable
            rows={entries}
            columns={columns}
            rowKey={(entry) => entry.id}
            emptyTitle={t("emptyTitle")}
            emptyHint={t("emptyHint")}
          />

          {totalPages > 1 ? (
            <div className="card-body row" style={{ justifyContent: "space-between" }}>
              {page > 1 ? (
                <a className="btn-link" href={`/admin/audit?page=${page - 1}`}>
                  {t("newer")}
                </a>
              ) : (
                <span />
              )}
              {page < totalPages ? (
                <a className="btn-link" href={`/admin/audit?page=${page + 1}`}>
                  {t("older")}
                </a>
              ) : (
                <span />
              )}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
