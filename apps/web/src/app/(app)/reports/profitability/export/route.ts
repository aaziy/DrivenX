import { can } from "@drivenx/auth";
import { businessDate } from "@drivenx/core";

import { currentPrincipal } from "@/lib/auth";
import { exportFormat, profitabilityTable, renderTable } from "@/lib/export/tables";
import { monthInput, profitabilityQuery } from "@/lib/reports/range";

/**
 * The profitability report as Excel or PDF (P1E-09, P1E-10): the same view and months as
 * the screen, read from the same query string, in the reader's language. The total row is
 * written as figures, not a formula, so the file matches the screen to the fil.
 */
export async function GET(request: Request) {
  const principal = await currentPrincipal();
  if (!principal) return new Response(null, { status: 401 });
  if (!can(principal, "report.financial") || !can(principal, "report.export")) {
    return new Response(null, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const query = profitabilityQuery(
    { view: params.get("view"), from: params.get("from"), to: params.get("to") },
    businessDate(new Date()),
  );
  if (!query.valid) return new Response(null, { status: 400 });

  const table = await profitabilityTable(query.view, query.from, query.to);
  return renderTable(
    table,
    exportFormat(params.get("format")),
    `profitability-${query.view}-${monthInput(query.from)}-to-${monthInput(query.to)}`,
  );
}
