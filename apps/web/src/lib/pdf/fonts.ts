/**
 * What every generated PDF shares: the bundled fonts and the Arabic rules learnt on the
 * contract PDF (P1D-18).
 *
 * Noto Sans for Latin and Noto Sans Arabic for Arabic, open-licensed and bundled so a
 * document looks the same wherever it is generated. Registered once, on first import.
 */

import { join } from "node:path";

import { Font } from "@react-pdf/renderer";

const FONT_DIR = join(process.cwd(), "assets", "fonts");

Font.register({
  family: "NotoSans",
  fonts: [{ src: join(FONT_DIR, "NotoSans.ttf") }, { src: join(FONT_DIR, "NotoSans-Bold.ttf"), fontWeight: 700 }],
});
Font.register({
  family: "NotoSansArabic",
  fonts: [
    { src: join(FONT_DIR, "NotoSansArabic.ttf") },
    { src: join(FONT_DIR, "NotoSansArabic-Bold.ttf"), fontWeight: 700 },
  ],
});
// Nothing is hyphenated: a split plate or amount misreads.
Font.registerHyphenationCallback((word) => [word]);

/** Arabic letters, and the marks Intl puts in Arabic dates to keep their parts in order. */
export const ARABIC = /[؀-ۿ‏؜]/;

/**
 * The document's script is tried first. With Latin first, some Arabic letters at the
 * start of a word were dropped.
 */
export function pdfFontFamily(rtl: boolean): string {
  return (rtl ? ["NotoSansArabic", "NotoSans"] : ["NotoSans", "NotoSansArabic"]) as unknown as string;
}

/**
 * Style helpers for one direction. React-PDF does not inherit `direction`, so every Text
 * takes `start` or `end`; and a value with no Arabic in it — a phone number, a code —
 * keeps its own left-to-right order on an Arabic page (`own`).
 */
export function directionStyles(direction: "ltr" | "rtl") {
  const rtl = direction === "rtl";
  return {
    rtl,
    row: { flexDirection: rtl ? "row-reverse" : "row" } as const,
    start: { textAlign: rtl ? "right" : "left", direction } as const,
    end: { textAlign: rtl ? "left" : "right", direction } as const,
    own: (text: string | null) => ({ direction: rtl && ARABIC.test(text ?? "") ? "rtl" : "ltr" }) as const,
  };
}
