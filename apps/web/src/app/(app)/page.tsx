import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { prisma } from "@drivenx/db";

import { requirePermission } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: `${t("title")} · DrivenX` };
}

/**
 * Dashboard placeholder.
 *
 * The real KPI tiles are milestone 1E, and every one of them will be a ledger
 * aggregate rather than a stored field (PROJECT_PLAN.md §3.2). What is here now
 * counts only what Phase 0 actually has, so nothing on screen is invented.
 */
export default async function DashboardPage() {
  const principal = await requirePermission("dashboard.view");

  const [t, userCount, roleCount, auditCount] = await Promise.all([
    getTranslations("dashboard"),
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.role.count(),
    prisma.auditLog.count(),
  ]);

  const firstName = principal.fullName.split(" ")[0] ?? principal.fullName;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("greeting", { name: firstName })}</h1>
          <p className="page-subtitle">{t("subtitle")}</p>
        </div>
      </header>

      <div className="page-body stack">
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-label">{t("activeUsers")}</div>
            <div className="stat-value">{userCount}</div>
          </div>
          <div className="stat">
            <div className="stat-label">{t("roles")}</div>
            <div className="stat-value">{roleCount}</div>
            <div className="stat-note">{t("rolesNote")}</div>
          </div>
          <div className="stat">
            <div className="stat-label">{t("auditEntries")}</div>
            <div className="stat-value">{auditCount}</div>
            <div className="stat-note">{t("auditNote")}</div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>{t("notYetTitle")}</h2>
          </div>
          <div className="card-body muted">
            <p style={{ marginTop: 0 }}>{t("notYetBody1")}</p>
            <p style={{ marginBottom: 0 }}>{t("notYetBody2")}</p>
          </div>
        </div>
      </div>
    </>
  );
}
