import { prisma } from "@drivenx/db";

import { requirePermission } from "@/lib/auth";

export const metadata = { title: "Dashboard · DrivenX" };

/**
 * Dashboard placeholder.
 *
 * The real KPI tiles are milestone 1E, and every one of them will be a ledger
 * aggregate rather than a stored field (PROJECT_PLAN.md §3.2). What is here now
 * counts only what Phase 0 actually has, so nothing on screen is invented.
 */
export default async function DashboardPage() {
  const principal = await requirePermission("dashboard.view");

  const [userCount, roleCount, auditCount] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.role.count(),
    prisma.auditLog.count(),
  ]);

  const firstName = principal.fullName.split(" ")[0] ?? principal.fullName;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Good day, {firstName}</h1>
          <p className="page-subtitle">
            Phase 0 foundations are in place. Fleet, customer and contract data arrive in Phase 1.
          </p>
        </div>
      </header>

      <div className="page-body stack">
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-label">Active users</div>
            <div className="stat-value">{userCount}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Roles</div>
            <div className="stat-value">{roleCount}</div>
            <div className="stat-note">Configurable per SOW §2</div>
          </div>
          <div className="stat">
            <div className="stat-label">Audit entries</div>
            <div className="stat-value">{auditCount}</div>
            <div className="stat-note">Every mutation recorded</div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>What is not here yet</h2>
          </div>
          <div className="card-body muted">
            <p style={{ marginTop: 0 }}>
              These tiles deliberately show only what exists. The KPIs from SOW §3 — fleet counts,
              monthly revenue, cost, profit, customer outstanding, supplier payables, expiring
              documents — are milestone 1E, and each will be an aggregation over the ledger rather
              than a stored column.
            </p>
            <p style={{ marginBottom: 0 }}>
              Showing placeholder numbers now would make the system look further along than it is.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
