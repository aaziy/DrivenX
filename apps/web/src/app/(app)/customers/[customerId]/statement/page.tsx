import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { businessDate } from "@drivenx/core";
import { customerStatement, prisma } from "@drivenx/db";

import { StatementView } from "@/components/statement-view";
import { statementRange } from "@/lib/reports/range";
import { requirePermission } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("statements");
  return { title: `${t("customerTitle")} · DrivenX` };
}

export default async function CustomerStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const principal = await requirePermission("payment.view");
  const [{ customerId }, query] = await Promise.all([params, searchParams]);

  const party = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, fullName: true },
  });
  if (!party) notFound();

  const range = statementRange(query, businessDate(new Date()));
  const [t, statement] = await Promise.all([
    getTranslations("statements"),
    range.valid ? customerStatement(party.id, range.from, range.to) : null,
  ]);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            <Link href={`/customers/${party.id}`}>{t("back", { name: party.fullName })}</Link>
          </p>
          <h1>{t("customerTitle")}</h1>
          <p className="page-subtitle">{t("customerSubtitle", { name: party.fullName })}</p>
        </div>
      </header>
      <div className="page-body stack">
        <StatementView
          statement={statement}
          side="customer"
          valid={range.valid}
          exportHref={
            principal.permissions.has("report.export")
              ? `/customers/${party.id}/statement/export?from=${range.from}&to=${range.to}`
              : null
          }
        />
      </div>
    </>
  );
}
