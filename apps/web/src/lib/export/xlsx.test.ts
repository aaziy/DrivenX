import { read, utils } from "xlsx";
import { describe, expect, it } from "vitest";

import { xlsxFile } from "./xlsx";

describe("xlsxFile", () => {
  it("writes amounts as numbers in dirhams with a money format, not as text", () => {
    const file = xlsxFile("Profitability", ["Vehicle", "Profit"], [
      ["Camry", { fils: 340_050n }],
      ["Total", { fils: -1_000n }],
    ]);
    // Formats are only read back when asked for.
    const sheet = read(file, { cellNF: true }).Sheets["Profitability"];
    expect(sheet).toBeDefined();

    const b2 = sheet?.["B2"];
    expect(b2?.t).toBe("n");
    expect(b2?.v).toBe(3400.5);
    expect(b2?.z).toBe("#,##0.00");
    expect(sheet?.["B3"]?.v).toBe(-10);
    expect(utils.sheet_to_json(sheet!, { header: 1 })[0]).toEqual(["Vehicle", "Profit"]);
  });

  it("leaves empty cells empty and marks an Arabic workbook right-to-left", () => {
    const file = xlsxFile("كشف", ["A", "B"], [[null, "x"]], true);
    const book = read(file, { bookViews: true } as never);
    expect(book.SheetNames).toEqual(["كشف"]);
    expect(book.Sheets["كشف"]?.["A2"]).toBeUndefined();
    expect(book.Workbook?.Views?.[0]?.RTL).toBe(true);
  });
});
