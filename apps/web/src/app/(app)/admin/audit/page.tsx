import { prisma } from "@drivenx/db";

import { DataTable, type Column } from "@/components/data-table";
import { requirePermission } from "@/lib/auth";

export const metadata = { title: "Audit log · DrivenX" };

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
function ChangeSummary({ before, after }: { before: unknown; after: unknown }) {
  const beforeRecord = (before ?? {}) as Record<string, unknown>;
  const afterRecord = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])];

  if (keys.length === 0) return <span className="muted">—</span>;

  // Whole-record snapshots (create/delete) would flood the column; summarise instead.
  if (keys.length > 4) {
    return <span className="muted mono">{keys.length} fields</span>;
  }

  return (
    <span className="mono">
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

  const [entries, total] = await Promise.all([
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
      header: "When",
      render: (entry) => (
        <time dateTime={entry.createdAt.toISOString()} className="mono">
          {entry.createdAt.toLocaleString("en-GB", { timeZone: "Asia/Dubai" })}
        </time>
      ),
    },
    {
      key: "who",
      header: "Who",
      render: (entry) =>
        entry.actor ? (
          <>
            <div>{entry.actor.fullName}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {entry.ipAddress ?? ""}
            </div>
          </>
        ) : (
          <span className="muted">System</span>
        ),
    },
    {
      key: "action",
      header: "Action",
      render: (entry) => (
        <span className={ACTION_TONE[entry.action] ?? "badge"}>{entry.action}</span>
      ),
    },
    {
      key: "entity",
      header: "Record",
      render: (entry) => (
        <>
          <div>{entry.entityType}</div>
          <div className="muted mono" style={{ fontSize: 11 }}>
            {entry.entityId.length > 34 ? `${entry.entityId.slice(0, 34)}…` : entry.entityId}
          </div>
        </>
      ),
    },
    {
      key: "changes",
      header: "Changes",
      render: (entry) => <ChangeSummary before={entry.before} after={entry.after} />,
    },
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Audit log</h1>
          <p className="page-subtitle">
            Every mutation, recorded automatically (SOW §17). Password hashes are never stored
            here &mdash; a changed secret is recorded as having changed, not as its value.
          </p>
        </div>
      </header>

      <div className="page-body">
        <div className="card">
          <div className="card-header">
            <h2>Recent activity</h2>
            <span className="muted">
              {total.toLocaleString("en-GB")} entries · page {page} of {totalPages}
            </span>
          </div>

          <DataTable
            rows={entries}
            columns={columns}
            rowKey={(entry) => entry.id}
            emptyTitle="No activity recorded yet"
            emptyHint="Actions taken in the system will appear here."
          />

          {totalPages > 1 ? (
            <div className="card-body row" style={{ justifyContent: "space-between" }}>
              {page > 1 ? (
                <a className="btn-link" href={`/admin/audit?page=${page - 1}`}>
                  ← Newer
                </a>
              ) : (
                <span />
              )}
              {page < totalPages ? (
                <a className="btn-link" href={`/admin/audit?page=${page + 1}`}>
                  Older →
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
