import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { businessDate } from "@drivenx/core";
import { supplierStatement, prisma } from "@drivenx/db";

import { StatementView } from "@/components/statement-view";
import { statementRange } from "@/lib/reports/range";
import { requirePermission } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("statements");
  return { title: `${t("supplierTitle")} · DrivenX` };
}

export default async function SupplierStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ supplierId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const principal = await requirePermission("supplier_invoice.view");
  const [{ supplierId }, query] = await Promise.all([params, searchParams]);

  const party = await prisma.supplier.findFirst({
    where: { id: supplierId, deletedAt: null },
    select: { id: true, companyName: true },
  });
  if (!party) notFound();

  const range = statementRange(query, businessDate(new Date()));
  const [t, statement] = await Promise.all([
    getTranslations("statements"),
    range.valid ? supplierStatement(party.id, range.from, range.to) : null,
  ]);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            <Link href={`/suppliers/${party.id}`}>{t("back", { name: party.companyName })}</Link>
          </p>
          <h1>{t("supplierTitle")}</h1>
          <p className="page-subtitle">{t("supplierSubtitle", { name: party.companyName })}</p>
        </div>
      </header>
      <div className="page-body stack">
        <StatementView
          statement={statement}
          side="supplier"
          valid={range.valid}
          exportHref={
            principal.permissions.has("report.export")
              ? `/suppliers/${party.id}/statement/export?from=${range.from}&to=${range.to}`
              : null
          }
        />
      </div>
    </>
  );
}
