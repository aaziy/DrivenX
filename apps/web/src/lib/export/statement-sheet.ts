import { getFormatter, getTranslations } from "next-intl/server";

import type { Statement } from "@drivenx/db";

import { currentLocale } from "@/i18n/locale";

import { type Cell, xlsxFile } from "./xlsx";

/**
 * A statement of account as a sheet: the opening balance, each line, then the closing
 * balance, with the same columns and words as the screen. A balance in the customer's
 * favour is written as a negative number, which is what it is to the reader's ledger.
 */
export async function statementSheet(statement: Statement, side: "customer" | "supplier", title: string) {
  const [t, format, locale] = await Promise.all([getTranslations("statements"), getFormatter(), currentLocale()]);
  const day = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const kinds = side === "customer" ? "kinds" : "supplierKinds";

  const header = [
    t("columns.date"),
    t("columns.item"),
    t("columns.reference"),
    t("columns.contract"),
    t("columns.debit"),
    t("columns.credit"),
    t("columns.balance"),
  ];
  const rows: Cell[][] = [
    [null, t("opening"), null, null, null, null, { fils: statement.openingFils }],
    ...statement.lines.map((line): Cell[] => [
      day(line.date),
      t(`${kinds}.${line.kind}`),
      line.reference,
      line.contractNumber,
      line.debitFils === 0n ? null : { fils: line.debitFils },
      line.creditFils === 0n ? null : { fils: line.creditFils },
      { fils: line.balanceFils },
    ]),
    [
      null,
      t("closing"),
      null,
      null,
      { fils: statement.debitsFils },
      { fils: statement.creditsFils },
      { fils: statement.closingFils },
    ],
  ];
  return xlsxFile(title, header, rows, locale === "ar");
}
