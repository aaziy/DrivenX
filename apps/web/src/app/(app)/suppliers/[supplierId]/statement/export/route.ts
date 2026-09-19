import { getTranslations } from "next-intl/server";

import { can } from "@drivenx/auth";
import { businessDate } from "@drivenx/core";
import { supplierStatement, prisma } from "@drivenx/db";

import { statementRange } from "@/lib/reports/range";
import { currentPrincipal } from "@/lib/auth";
import { statementSheet } from "@/lib/export/statement-sheet";
import { xlsxResponse } from "@/lib/export/xlsx";

/** The supplier statement as Excel (P1E-09), for the same range as the screen. */
export async function GET(request: Request, { params }: { params: Promise<{ supplierId: string }> }) {
  const principal = await currentPrincipal();
  if (!principal) return new Response(null, { status: 401 });
  if (!can(principal, "supplier_invoice.view") || !can(principal, "report.export")) return new Response(null, { status: 403 });

  const { supplierId } = await params;
  const party = await prisma.supplier.findFirst({ where: { id: supplierId, deletedAt: null }, select: { id: true, code: true } });
  if (!party) return new Response(null, { status: 404 });

  const search = new URL(request.url).searchParams;
  const range = statementRange(
    { from: search.get("from") ?? undefined, to: search.get("to") ?? undefined },
    businessDate(new Date()),
  );
  if (!range.valid) return new Response(null, { status: 400 });

  const [t, statement] = await Promise.all([
    getTranslations("statements"),
    supplierStatement(party.id, range.from, range.to),
  ]);
  const file = await statementSheet(statement, "supplier", t("supplierTitle"));
  return xlsxResponse(file, `statement-${party.code}-${range.from}-to-${range.to}.xlsx`);
}
