/**
 * The contract as a printable document (P1D-18).
 *
 * Pure: it takes the figures and the words already resolved, and lays them out. Loading
 * the contract and choosing the language happen in the route, so this can be rendered in
 * a test without a database or a request.
 *
 * Arabic is laid out by hand. Rows are reversed so they run right to left, and every
 * piece of text carries `direction: rtl` itself — React-PDF does not inherit it, and a
 * paragraph left at its default of left-to-right puts an Arabic sentence's full stop at
 * the wrong end and a date's parts out of order. The glyph shaping and the ordering of
 * mixed Arabic and Latin runs (a plate, an amount) were checked by eye.
 */

import { join } from "node:path";

import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

const FONT_DIR = join(process.cwd(), "assets", "fonts");

// Noto Sans for Latin, Noto Sans Arabic for Arabic, both open-licensed and bundled so the
// document looks the same wherever it is generated.
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
// Contract wording is never hyphenated: a split plate or amount misreads.
Font.registerHyphenationCallback((word) => [word]);

export interface ContractPdfRow {
  due: string;
  charge: string;
  invoice: string | null;
  net: string;
  vat: string;
  gross: string;
  waived: boolean;
}

export interface ContractPdfData {
  number: string;
  typeLabel: string;
  statusLabel: string;
  /** Not yet active: the schedule is what activation will produce, not an invoice. */
  draft: boolean;
  generatedOn: string;
  customer: { name: string; code: string; mobile: string; email: string | null; address: string | null };
  vehicle: { description: string; code: string; plate: string; vin: string; colour: string | null };
  terms: Array<{ label: string; value: string }>;
  schedule: ContractPdfRow[];
  totals: { net: string; vat: string; gross: string };
  notes: string | null;
}

export interface ContractPdfLabels {
  title: string;
  draftBanner: string;
  customer: string;
  vehicle: string;
  customerCode: string;
  mobile: string;
  email: string;
  address: string;
  vehicleCode: string;
  plate: string;
  vin: string;
  colour: string;
  terms: string;
  schedule: string;
  due: string;
  charge: string;
  invoice: string;
  net: string;
  vat: string;
  gross: string;
  total: string;
  waived: string;
  notes: string;
  vatNote: string;
  signatures: string;
  customerSignature: string;
  companySignature: string;
  nameAndDate: string;
  generated: string;
  page: (current: number, total: number) => string;
}

/** Arabic letters, and the marks Intl puts in Arabic dates to keep their parts in order. */
const ARABIC = /[\u0600-\u06FF\u200F\u061C]/;
const INK = "#1f2933";
const MUTED = "#6b7280";
const RULE = "#d9dee4";
const ACCENT = "#1f5135";

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
    color: INK,
  },
  // Line height lives on the content, with the font size beside it so the 1.4 resolves
  // against 9.5pt. On the page, it left the page number (a `render` Text) out entirely.
  body: { fontSize: 9.5, lineHeight: 1.4 },
  brand: { fontSize: 16, lineHeight: 1.3, fontWeight: 700, color: ACCENT },
  title: { fontSize: 13, lineHeight: 1.4, fontWeight: 700 },
  muted: { color: MUTED },
  banner: {
    marginTop: 12,
    padding: 6,
    backgroundColor: "#fdf3dc",
    color: "#8a5a00",
    fontWeight: 700,
    textAlign: "center",
  },
  section: { marginTop: 18 },
  heading: {
    fontSize: 10.5,
    fontWeight: 700,
    paddingBottom: 4,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  cell: { paddingVertical: 3, paddingHorizontal: 4 },
  headCell: { fontWeight: 700, color: MUTED, fontSize: 8.5 },
  tableRow: { borderBottomWidth: 0.5, borderBottomColor: RULE },
  totalRow: { borderTopWidth: 1, borderTopColor: INK, fontWeight: 700 },
  signatureLine: { marginTop: 36, borderTopWidth: 1, borderTopColor: INK, paddingTop: 4 },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 8, color: MUTED },
});

/** Widths of the schedule's columns, in reading order. */
const COLUMNS = { due: "17%", charge: "22%", invoice: "16%", net: "15%", vat: "13%", gross: "17%" } as const;

export function ContractPdf({
  data,
  labels,
  direction,
}: {
  data: ContractPdfData;
  labels: ContractPdfLabels;
  direction: "ltr" | "rtl";
}) {
  const rtl = direction === "rtl";
  const row = { flexDirection: rtl ? "row-reverse" : "row" } as const;
  // Every Text takes one of these, so none is left at the default direction.
  const start = { textAlign: rtl ? "right" : "left", direction } as const;
  const end = { textAlign: rtl ? "left" : "right", direction } as const;
  const footerStart = { textAlign: start.textAlign, direction } as const;
  const footerEnd = { textAlign: end.textAlign, direction } as const;
  // A phone number, VIN or code has no Arabic in it and keeps its own left-to-right order
  // on an Arabic page, still aligned to the page's side: "+971…" must not become "…971+".
  const own = (text: string | null) =>
    ({ direction: rtl && ARABIC.test(text ?? "") ? "rtl" : "ltr" }) as const;
  // The script the document is in is tried first. With Latin first, some Arabic letters
  // at the start of a word were dropped.
  const fontFamily = (rtl ? ["NotoSansArabic", "NotoSans"] : ["NotoSans", "NotoSansArabic"]) as unknown as string;

  const pair = (label: string, value: string | null) =>
    value ? (
      <View style={[row, { marginBottom: 2 }]}>
        <Text style={[styles.muted, start, { width: "38%" }]}>{label}</Text>
        <Text style={[start, own(value), { width: "62%" }]}>{value}</Text>
      </View>
    ) : null;

  return (
    <Document title={`${data.number} · ${labels.title}`} author="DrivenX" language={rtl ? "ar" : "en"}>
      <Page size="A4" style={[styles.page, { fontFamily }]}>
        <View style={styles.body}>
        <View style={[row, { justifyContent: "space-between", alignItems: "flex-start" }]}>
          <View>
            <Text style={[styles.brand, start]}>DrivenX</Text>
          </View>
          <View>
            <Text style={[styles.title, end]}>{labels.title}</Text>
            <Text style={end}>
              {data.number} · {data.typeLabel}
            </Text>
            <Text style={[styles.muted, end]}>{data.statusLabel}</Text>
          </View>
        </View>

        {data.draft ? <Text style={[styles.banner, { direction }]}>{labels.draftBanner}</Text> : null}

        <View style={[row, styles.section, { gap: 24 }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.heading, start]}>{labels.customer}</Text>
            <Text style={[start, { fontWeight: 700, marginBottom: 3 }]}>{data.customer.name}</Text>
            {pair(labels.customerCode, data.customer.code)}
            {pair(labels.mobile, data.customer.mobile)}
            {pair(labels.email, data.customer.email)}
            {pair(labels.address, data.customer.address)}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.heading, start]}>{labels.vehicle}</Text>
            <Text style={[start, { fontWeight: 700, marginBottom: 3 }]}>{data.vehicle.description}</Text>
            {pair(labels.vehicleCode, data.vehicle.code)}
            {pair(labels.plate, data.vehicle.plate)}
            {pair(labels.vin, data.vehicle.vin)}
            {pair(labels.colour, data.vehicle.colour)}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.heading, start]}>{labels.terms}</Text>
          {data.terms.map((term) => (
            <View key={term.label} style={[row, { marginBottom: 2 }]}>
              <Text style={[styles.muted, start, { width: "38%" }]}>{term.label}</Text>
              <Text style={[start, own(term.value), { width: "62%" }]}>{term.value}</Text>
            </View>
          ))}
          <Text style={[styles.muted, start, { marginTop: 4, fontSize: 8.5 }]}>{labels.vatNote}</Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.heading, start]}>{labels.schedule}</Text>
          <View style={[row, styles.tableRow]} fixed>
            <Text style={[styles.cell, styles.headCell, start, { width: COLUMNS.due }]}>{labels.due}</Text>
            <Text style={[styles.cell, styles.headCell, start, { width: COLUMNS.charge }]}>{labels.charge}</Text>
            <Text style={[styles.cell, styles.headCell, start, { width: COLUMNS.invoice }]}>{labels.invoice}</Text>
            <Text style={[styles.cell, styles.headCell, end, { width: COLUMNS.net }]}>{labels.net}</Text>
            <Text style={[styles.cell, styles.headCell, end, { width: COLUMNS.vat }]}>{labels.vat}</Text>
            <Text style={[styles.cell, styles.headCell, end, { width: COLUMNS.gross }]}>{labels.gross}</Text>
          </View>
          {data.schedule.map((item, index) => (
            <View key={index} style={[row, styles.tableRow, item.waived ? { color: MUTED } : {}]} wrap={false}>
              <Text style={[styles.cell, start, { width: COLUMNS.due }]}>{item.due}</Text>
              <Text style={[styles.cell, start, { width: COLUMNS.charge }]}>
                {item.waived ? `${item.charge} · ${labels.waived}` : item.charge}
              </Text>
              <Text style={[styles.cell, start, { width: COLUMNS.invoice }]}>{item.invoice ?? "—"}</Text>
              <Text style={[styles.cell, end, { width: COLUMNS.net }]}>{item.net}</Text>
              <Text style={[styles.cell, end, { width: COLUMNS.vat }]}>{item.vat}</Text>
              <Text style={[styles.cell, end, { width: COLUMNS.gross }]}>{item.gross}</Text>
            </View>
          ))}
          <View style={[row, styles.totalRow]} wrap={false}>
            <Text style={[styles.cell, start, { width: "55%" }]}>{labels.total}</Text>
            <Text style={[styles.cell, end, { width: COLUMNS.net }]}>{data.totals.net}</Text>
            <Text style={[styles.cell, end, { width: COLUMNS.vat }]}>{data.totals.vat}</Text>
            <Text style={[styles.cell, end, { width: COLUMNS.gross }]}>{data.totals.gross}</Text>
          </View>
        </View>

        {data.notes ? (
          <View style={styles.section}>
            <Text style={[styles.heading, start]}>{labels.notes}</Text>
            <Text style={start}>{data.notes}</Text>
          </View>
        ) : null}

        <View style={styles.section} wrap={false}>
          <Text style={[styles.heading, start]}>{labels.signatures}</Text>
          <View style={[row, { gap: 40 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.signatureLine, start]}>{labels.customerSignature}</Text>
              <Text style={[styles.muted, start]}>{labels.nameAndDate}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.signatureLine, start]}>{labels.companySignature}</Text>
              <Text style={[styles.muted, start]}>{labels.nameAndDate}</Text>
            </View>
          </View>
        </View>

        </View>

        {/* Two full-width lines over each other, one aligned to each side. */}
        <Text style={[styles.footer, footerStart]} fixed>
          {`${data.number} · ${labels.generated} ${data.generatedOn}`}
        </Text>
        <Text
          style={[styles.footer, footerEnd]}
          fixed
          // The first layout pass may have no page count yet.
          render={({ pageNumber, totalPages }) => labels.page(pageNumber, totalPages ?? pageNumber)}
        />
      </Page>
    </Document>
  );
}
