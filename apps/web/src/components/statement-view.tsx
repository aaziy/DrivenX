import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { Money } from "@drivenx/core";
import type { Statement } from "@drivenx/db";

/**
 * A statement of account, for a customer or a supplier (P1E-07, P1E-08).
 *
 * Shared, because the two are the same document from opposite sides; only the words for
 * the lines differ. The range form is a plain GET, so a statement is a link.
 */
export async function StatementView({
  statement,
  side,
  valid,
  exportHref,
}: {
  statement: Statement | null;
  side: "customer" | "supplier";
  valid: boolean;
  /** Where to download it as Excel, or null when the reader may not export. */
  exportHref: string | null;
}) {
  const [t, format] = await Promise.all([getTranslations("statements"), getFormatter()]);
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const kinds = side === "customer" ? "kinds" : "supplierKinds";
  const amount = (fils: bigint) => (fils === 0n ? "" : Money.format(fils, { currency: null }));
  const balance = (fils: bigint) =>
    fils < 0n ? (
      <>
        {Money.format(-fils, { currency: null })} <span className="badge badge-success">{t("inCredit")}</span>
      </>
    ) : (
      Money.format(fils, { currency: null })
    );

  return (
    <>
      <form method="get" className="card">
        <div className="card-body row" style={{ gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="from">{t("from")}</label>
            <input id="from" name="from" type="date" dir="ltr" defaultValue={statement?.from} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="to">{t("to")}</label>
            <input id="to" name="to" type="date" dir="ltr" defaultValue={statement?.to} />
          </div>
          <button type="submit" className="btn-primary">
            {t("apply")}
          </button>
        </div>
      </form>

      <div className="card">
        {!valid || !statement ? (
          <div className="card-body">
            <p className="field-error">{t("rangeInvalid")}</p>
          </div>
        ) : (
          <>
            <div className="card-header">
              <h2>
                {day(statement.from)} – {day(statement.to)}
              </h2>
              <span className="row" style={{ gap: 12, alignItems: "center" }}>
                <span className="muted">{t("vatNote")}</span>
                {exportHref ? (
                  <a className="btn-secondary" href={exportHref}>
                    {t("exportExcel")}
                  </a>
                ) : null}
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="data" aria-label={t("columns.balance")}>
                <thead>
                  <tr>
                    <th>{t("columns.date")}</th>
                    <th>{t("columns.item")}</th>
                    <th>{t("columns.reference")}</th>
                    <th>{t("columns.contract")}</th>
                    <th className="numeric">{t("columns.debit")}</th>
                    <th className="numeric">{t("columns.credit")}</th>
                    <th className="numeric">{t("columns.balance")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={6} className="muted">
                      {t("opening")}
                    </td>
                    <td className="numeric" style={{ whiteSpace: "nowrap" }}>
                      {balance(statement.openingFils)}
                    </td>
                  </tr>
                  {statement.lines.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="muted">
                        {t("empty")}
                      </td>
                    </tr>
                  ) : (
                    statement.lines.map((line, index) => (
                      <tr key={index}>
                        <td style={{ whiteSpace: "nowrap" }}>{day(line.date)}</td>
                        <td>{t(`${kinds}.${line.kind}`)}</td>
                        <td className="muted">{line.reference ? <bdi>{line.reference}</bdi> : "—"}</td>
                        <td>
                          {line.contractId ? (
                            <Link href={`/contracts/${line.contractId}`}>
                              <bdi>{line.contractNumber}</bdi>
                            </Link>
                          ) : null}
                        </td>
                        <td className="numeric" style={{ whiteSpace: "nowrap" }}>
                          {amount(line.debitFils)}
                        </td>
                        <td className="numeric" style={{ whiteSpace: "nowrap" }}>
                          {amount(line.creditFils)}
                        </td>
                        <td className="numeric" style={{ whiteSpace: "nowrap" }}>
                          {balance(line.balanceFils)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="report-total">
                    <td colSpan={4} style={{ fontWeight: 650 }}>
                      {t("closing")}
                    </td>
                    <td className="numeric" style={{ whiteSpace: "nowrap", fontWeight: 650 }}>
                      {Money.format(statement.debitsFils, { currency: null })}
                    </td>
                    <td className="numeric" style={{ whiteSpace: "nowrap", fontWeight: 650 }}>
                      {Money.format(statement.creditsFils, { currency: null })}
                    </td>
                    <td className="numeric" style={{ whiteSpace: "nowrap", fontWeight: 650 }}>
                      {balance(statement.closingFils)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
