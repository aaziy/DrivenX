import { utils, write } from "xlsx";

/** A cell: text, a whole number, or an amount in fils written as AED. */
export type Cell = string | number | { fils: bigint } | null;

const AED_FORMAT = "#,##0.00";

/**
 * One sheet as an .xlsx file (P1E-09).
 *
 * Amounts go in as numbers with a two-decimal format rather than as formatted text, so
 * whoever opens the file can total and filter them. Fils become dirhams by dividing by
 * 100, which is exact for every amount this system handles (well under 2^53 fils).
 */
export function xlsxFile(sheetName: string, header: string[], rows: Cell[][], rightToLeft = false): Buffer {
  const data = [header, ...rows.map((row) => row.map((cell) => toValue(cell)))];
  const sheet = utils.aoa_to_sheet(data);

  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell !== null && typeof cell === "object") {
        const address = utils.encode_cell({ r: r + 1, c });
        const target = sheet[address];
        if (target) target.z = AED_FORMAT;
      }
    });
  });

  // Wide enough for each column's longest value, so nothing opens as ####.
  sheet["!cols"] = header.map((title, c) => ({
    wch: Math.min(
      60,
      Math.max(title.length, ...data.slice(1).map((row) => String(row[c] ?? "").length + 2), 8),
    ),
  }));

  const book = utils.book_new();
  utils.book_append_sheet(book, sheet, sheetName.slice(0, 31));
  if (rightToLeft) book.Workbook = { Views: [{ RTL: true }] };
  return write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function toValue(cell: Cell): string | number | null {
  if (cell === null) return null;
  if (typeof cell === "object") return Number(cell.fils) / 100;
  return cell;
}

/** Response headers for a download named `fileName`. */
export function xlsxResponse(file: Buffer, fileName: string): Response {
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Length": String(file.byteLength),
      "Content-Disposition": `attachment; filename="${fileName}"`,
      // Financial figures: no shared cache keeps a copy.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
