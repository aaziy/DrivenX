import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

/**
 * Table primitive (P0-11).
 *
 * Server-rendered and generic over the row type, so a column's `render` is checked
 * against the actual row shape rather than `any`. Every list screen in Phase 1 —
 * customers, vehicles, contracts, instalments — uses this, so the empty state is
 * built in rather than left to each caller to forget.
 */

export interface Column<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  /** Right-align and tabular-align — for money and counts. */
  numeric?: boolean;
  width?: string;
}

interface DataTableProps<Row> {
  rows: readonly Row[];
  columns: ReadonlyArray<Column<Row>>;
  rowKey: (row: Row) => string;
  emptyTitle?: string;
  emptyHint?: string;
}

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  emptyTitle,
  emptyHint,
}: DataTableProps<Row>) {
  const t = useTranslations("common");

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">{emptyTitle ?? t("emptyTitle")}</div>
        {emptyHint ? <div>{emptyHint}</div> : null}
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={column.numeric ? "numeric" : undefined}
                style={column.width ? { width: column.width } : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.key} className={column.numeric ? "numeric" : undefined}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
