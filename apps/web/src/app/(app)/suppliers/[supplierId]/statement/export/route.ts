import { can } from "@drivenx/auth";
import { businessDate } from "@drivenx/core";
import { supplierStatement, prisma } from "@drivenx/db";

import { currentPrincipal } from "@/lib/auth";
import { exportFormat, renderTable, statementTable } from "@/lib/export/tables";
import { statementRange } from "@/lib/reports/range";

/** The supplier statement as Excel or PDF (P1E-09, P1E-10), for the same range as the screen. */
export async function GET(request: Request, { params }: { params: Promise<{ supplierId: string }> }) {
  const principal = await currentPrincipal();
  if (!principal) return new Response(null, { status: 401 });
  if (!can(principal, "supplier_invoice.view") || !can(principal, "report.export")) return new Response(null, { status: 403 });

  const { supplierId } = await params;
  const party = await prisma.supplier.findFirst({
    where: { id: supplierId, deletedAt: null },
    select: { id: true, code: true, companyName: true },
  });
  if (!party) return new Response(null, { status: 404 });

  const search = new URL(request.url).searchParams;
  const range = statementRange(
    { from: search.get("from") ?? undefined, to: search.get("to") ?? undefined },
    businessDate(new Date()),
  );
  if (!range.valid) return new Response(null, { status: 400 });

  const statement = await supplierStatement(party.id, range.from, range.to);
  const table = await statementTable(statement, "supplier", party.companyName);
  return renderTable(
    table,
    exportFormat(search.get("format")),
    `statement-${party.code}-${range.from}-to-${range.to}`,
  );
}
