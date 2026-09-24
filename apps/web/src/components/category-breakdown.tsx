import { getTranslations } from "next-intl/server";

import { categoryLabelKey, isKnownCategory, Money } from "@drivenx/core";
import type { CategoryTotal } from "@drivenx/db";

/**
 * A ledger range grouped by what the money actually was (P2-13).
 *
 * Shared by the profitability report and a car's lifetime view, so the two cannot
 * describe the same entries differently.
 *
 * A category with no name is printed as its raw key rather than hidden. The catalogues
 * are checked against the known list in a test, so this should never happen — but a
 * report that silently dropped money it could not label would be worse than an ugly row,
 * because the totals would stop adding up and nothing would say why.
 */
export async function CategoryBreakdown({ totals }: { totals: CategoryTotal[] }) {
  const t = await getTranslations("reports");
  const amount = (fils: bigint) => Money.format(fils, { currency: null });

  const side = (direction: "REVENUE" | "COST") => totals.filter((row) => row.direction === direction);
  const sum = (rows: CategoryTotal[]) => rows.reduce((total, row) => total + row.amountFils, 0n);

  const revenue = side("REVENUE");
  const cost = side("COST");
  const label = (category: string) =>
    isKnownCategory(category) ? t(`ledgerCategories.${categoryLabelKey(category)}` as never) : category;

  if (totals.length === 0) return null;

  return (
    <table className="deal-table">
      <tbody>
        {revenue.length > 0 ? (
          <tr>
            <td className="field-label" colSpan={2} style={{ textAlign: "start" }}>
              {t("revenueSide")}
            </td>
          </tr>
        ) : null}
        {revenue.map((row) => (
          <tr key={row.category}>
            <td>{label(row.category)}</td>
            <td className="numeric">{amount(row.amountFils)}</td>
          </tr>
        ))}

        {cost.length > 0 ? (
          <tr>
            <td className="field-label" colSpan={2} style={{ textAlign: "start" }}>
              {t("costSide")}
            </td>
          </tr>
        ) : null}
        {cost.map((row) => (
          <tr key={row.category}>
            <td>{label(row.category)}</td>
            <td className="numeric">{amount(row.amountFils)}</td>
          </tr>
        ))}

        <tr className="deal-profit">
          <td>{t("columns.profit")}</td>
          <td className="numeric">{amount(sum(revenue) - sum(cost))}</td>
        </tr>
      </tbody>
    </table>
  );
}
