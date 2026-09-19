import { can } from "@drivenx/auth";
import { businessDate } from "@drivenx/core";
import { customerStatement, prisma } from "@drivenx/db";

import { currentPrincipal } from "@/lib/auth";
import { exportFormat, renderTable, statementTable } from "@/lib/export/tables";
import { statementRange } from "@/lib/reports/range";

/** The customer statement as Excel or PDF (P1E-09, P1E-10), for the same range as the screen. */
export async function GET(request: Request, { params }: { params: Promise<{ customerId: string }> }) {
  const principal = await currentPrincipal();
  if (!principal) return new Response(null, { status: 401 });
  if (!can(principal, "payment.view") || !can(principal, "report.export")) return new Response(null, { status: 403 });

  const { customerId } = await params;
  const party = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, code: true, fullName: true },
  });
  if (!party) return new Response(null, { status: 404 });

  const search = new URL(request.url).searchParams;
  const range = statementRange(
    { from: search.get("from") ?? undefined, to: search.get("to") ?? undefined },
    businessDate(new Date()),
  );
  if (!range.valid) return new Response(null, { status: 400 });

  const statement = await customerStatement(party.id, range.from, range.to);
  const table = await statementTable(statement, "customer", party.fullName);
  return renderTable(
    table,
    exportFormat(search.get("format")),
    `statement-${party.code}-${range.from}-to-${range.to}`,
  );
}
