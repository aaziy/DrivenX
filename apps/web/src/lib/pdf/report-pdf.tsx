/**
 * A report as a printable document (P1E-10).
 *
 * One table layout for every report — profitability, statements — so each export is the
 * rows its screen shows, already worded and formatted, laid out here. Wide reports turn
 * the page to landscape rather than shrinking the type.
 *
 * Arabic follows the contract PDF's rules (see fonts.ts): rows reversed, every Text given
 * its direction, Latin-only values kept left-to-right. The page number sits outside the
 * content, which carries the line height, so React-PDF prints it.
 */

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { directionStyles, pdfFontFamily } from "./fonts";

export interface ReportPdfColumn {
  label: string;
  numeric?: boolean;
  /** Relative width; columns share the page in proportion. */
  weight?: number;
}

export interface ReportPdfProps {
  title: string;
  /** The range or party the report covers. */
  subtitle: string;
  /** A line under the subtitle, such as a note on VAT. */
  note?: string;
  columns: ReportPdfColumn[];
  rows: string[][];
  /** Closing row, set apart. */
  total?: string[];
  /** A row before the others, such as a balance brought forward. */
  lead?: string[];
  generated: string;
  page: (current: number, total: number) => string;
  direction: "ltr" | "rtl";
}

const INK = "#1f2933";
const MUTED = "#6b7280";
const RULE = "#d9dee4";
const ACCENT = "#1f5135";

const styles = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 52, paddingHorizontal: 36, color: INK },
  body: { fontSize: 8.5, lineHeight: 1.35 },
  brand: { fontSize: 14, lineHeight: 1.3, fontWeight: 700, color: ACCENT },
  title: { fontSize: 12, lineHeight: 1.4, fontWeight: 700 },
  muted: { color: MUTED },
  table: { marginTop: 14 },
  cell: { paddingVertical: 3, paddingHorizontal: 4 },
  head: { fontWeight: 700, color: MUTED, fontSize: 7.5, borderBottomWidth: 1, borderBottomColor: RULE },
  line: { borderBottomWidth: 0.5, borderBottomColor: RULE },
  total: { borderTopWidth: 1, borderTopColor: INK, fontWeight: 700 },
  footer: { position: "absolute", bottom: 22, left: 36, right: 36, fontSize: 7.5, color: MUTED },
});

export function ReportPdf(props: ReportPdfProps) {
  const { rtl, row, start, end, own } = directionStyles(props.direction);
  const landscape = props.columns.length > 7;
  const totalWeight = props.columns.reduce((sum, column) => sum + (column.weight ?? 1), 0);
  const width = (column: ReportPdfColumn) => `${((column.weight ?? 1) / totalWeight) * 100}%`;

  const cells = (values: string[]) =>
    props.columns.map((column, index) => {
      const value = values[index] ?? "";
      return (
        <Text
          key={index}
          style={[styles.cell, column.numeric ? end : start, own(value), { width: width(column) }]}
        >
          {value}
        </Text>
      );
    });

  return (
    <Document title={`${props.title} · ${props.subtitle}`} author="DrivenX" language={rtl ? "ar" : "en"}>
      <Page
        size="A4"
        orientation={landscape ? "landscape" : "portrait"}
        style={[styles.page, { fontFamily: pdfFontFamily(rtl) }]}
      >
        <View style={styles.body}>
          <View style={[row, { justifyContent: "space-between", alignItems: "flex-start" }]}>
            <Text style={[styles.brand, start]}>DrivenX</Text>
            <View>
              <Text style={[styles.title, end]}>{props.title}</Text>
              <Text style={[end, own(props.subtitle)]}>{props.subtitle}</Text>
              {props.note ? <Text style={[styles.muted, end]}>{props.note}</Text> : null}
            </View>
          </View>

          <View style={styles.table}>
            <View style={[row, styles.head]}>
              {cells(props.columns.map((column) => column.label))}
            </View>
            {props.lead ? (
              <View style={[row, styles.line, styles.muted]} wrap={false}>
                {cells(props.lead)}
              </View>
            ) : null}
            {props.rows.map((values, index) => (
              <View key={index} style={[row, styles.line]} wrap={false}>
                {cells(values)}
              </View>
            ))}
            {props.total ? (
              <View style={[row, styles.total]} wrap={false}>
                {cells(props.total)}
              </View>
            ) : null}
          </View>
        </View>

        <Text style={[styles.footer, { textAlign: start.textAlign, direction: props.direction }]} fixed>
          {props.generated}
        </Text>
        <Text
          style={[styles.footer, { textAlign: end.textAlign, direction: props.direction }]}
          fixed
          render={({ pageNumber, totalPages }) => props.page(pageNumber, totalPages ?? pageNumber)}
        />
      </Page>
    </Document>
  );
}
