import { getTranslations } from "next-intl/server";

import { can } from "@drivenx/auth";
import { businessDate } from "@drivenx/core";
import { customerStatement, prisma } from "@drivenx/db";

import { statementRange } from "@/lib/reports/range";
import { currentPrincipal } from "@/lib/auth";
import { statementSheet } from "@/lib/export/statement-sheet";
import { xlsxResponse } from "@/lib/export/xlsx";

/** The customer statement as Excel (P1E-09), for the same range as the screen. */
export async function GET(request: Request, { params }: { params: Promise<{ customerId: string }> }) {
  const principal = await currentPrincipal();
  if (!principal) return new Response(null, { status: 401 });
  if (!can(principal, "payment.view") || !can(principal, "report.export")) return new Response(null, { status: 403 });

  const { customerId } = await params;
  const party = await prisma.customer.findFirst({ where: { id: customerId, deletedAt: null }, select: { id: true, code: true } });
  if (!party) return new Response(null, { status: 404 });

  const search = new URL(request.url).searchParams;
  const range = statementRange(
    { from: search.get("from") ?? undefined, to: search.get("to") ?? undefined },
    businessDate(new Date()),
  );
  if (!range.valid) return new Response(null, { status: 400 });

  const [t, statement] = await Promise.all([
    getTranslations("statements"),
    customerStatement(party.id, range.from, range.to),
  ]);
  const file = await statementSheet(statement, "customer", t("customerTitle"));
  return xlsxResponse(file, `statement-${party.code}-${range.from}-to-${range.to}.xlsx`);
}
