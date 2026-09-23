/**
 * The handover or return report (P2-04, SOW §12).
 *
 * Pure, like the contract PDF: it takes figures and words already resolved, so it can be
 * rendered in a test without a database or a request.
 *
 * The car is drawn from `BODY_PANELS` — the same table the screen draws and the same one
 * that named each panel when the mark was made. A second set of coordinates for print is
 * how the report ends up showing a scratch on a different door from the one the customer
 * pointed at.
 */

import {
  Circle,
  Document,
  G,
  Image,
  Page,
  Rect,
  StyleSheet,
  Svg,
  Text,
  Text as SvgText,
  View,
} from "@react-pdf/renderer";

import { BODY_PANELS, type DamageSeverity, type VehiclePanel } from "@drivenx/core";

import { directionStyles, pdfFontFamily } from "./fonts";

const DIAGRAM_WIDTH = 150;
const DIAGRAM_HEIGHT = 240;

export interface HandoverPdfMark {
  number: number;
  panelLabel: string;
  severity: DamageSeverity;
  severityLabel: string;
  note: string | null;
  positionX: number | null;
  positionY: number | null;
}

export interface HandoverPdfData {
  title: string;
  contractNumber: string;
  generatedOn: string;
  occurredAt: string;
  customer: { name: string; code: string; mobile: string };
  vehicle: { description: string; code: string; plate: string; vin: string };
  odometer: string;
  fuel: string;
  conditionNotes: string | null;
  marks: HandoverPdfMark[];
  /** PNG bytes, as data URLs; absent on a form still in draft. */
  customerSignature: string | null;
  customerSignatureName: string | null;
  staffSignature: string | null;
  staffSignatureName: string | null;
}

export interface HandoverPdfLabels {
  contract: string;
  customer: string;
  vehicle: string;
  customerCode: string;
  mobile: string;
  vehicleCode: string;
  plate: string;
  vin: string;
  occurredAt: string;
  odometer: string;
  fuel: string;
  condition: string;
  damage: string;
  noDamage: string;
  diagramNote: string;
  signatures: string;
  customerSignature: string;
  staffSignature: string;
  unsigned: string;
  generated: string;
  page: (current: number, total: number) => string;
}

const INK = "#1f2933";
const MUTED = "#6b7280";
const RULE = "#d9dee4";
const ACCENT = "#1f5135";

/** Presentation only, as on screen: glass reads differently from metal. */
const GLASS: ReadonlySet<VehiclePanel> = new Set(["WINDSCREEN", "REAR_SCREEN"]);

const SEVERITY_INK: Record<DamageSeverity, string> = {
  MINOR: "#b45309",
  MODERATE: "#c2410c",
  SEVERE: "#a8202b",
};

const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 40, color: INK },
  body: { fontSize: 9.5, lineHeight: 1.4 },
  // The line height is explicit on both. Left to inherit, an Arabic title and the line
  // under it overlap: Arabic glyphs are taller than the Latin the default was set for.
  title: { fontSize: 17, lineHeight: 1.4, fontWeight: 700, color: ACCENT, marginBottom: 2 },
  subtitle: { fontSize: 10, lineHeight: 1.4, color: MUTED, marginBottom: 16 },
  section: { marginTop: 14 },
  heading: { fontSize: 11, fontWeight: 700, marginBottom: 6 },
  label: { color: MUTED, width: 70 },
  value: { flex: 1 },
  detailRow: { marginBottom: 2 },
  panelBox: { flex: 1 },
  markRow: { marginBottom: 4, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: RULE },
  markNumber: { width: 18, fontWeight: 700 },
  signatureBox: { flex: 1 },
  signatureImage: { height: 56, objectFit: "contain" },
  signatureRule: { borderTopWidth: 1, borderTopColor: INK, marginTop: 4, paddingTop: 3 },
  muted: { color: MUTED },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 40,
    right: 40,
    fontSize: 8,
    color: MUTED,
  },
});

/** The car, from the one region table, with the marks on it. */
function Diagram({ marks }: { marks: HandoverPdfMark[] }) {
  return (
    <Svg width={DIAGRAM_WIDTH} height={DIAGRAM_HEIGHT} viewBox={`0 0 ${DIAGRAM_WIDTH} ${DIAGRAM_HEIGHT}`}>
      {/* The silhouette first, as on screen: the same car, drawn the same way. */}
      <Rect
        x={0.17 * DIAGRAM_WIDTH}
        y={0.02 * DIAGRAM_HEIGHT}
        width={0.66 * DIAGRAM_WIDTH}
        height={0.96 * DIAGRAM_HEIGHT}
        rx={14}
        fill="#f1f3f6"
        stroke="#667085"
        strokeWidth={1}
      />
      {BODY_PANELS.map((region) => (
        <Rect
          key={region.panel}
          x={region.x * DIAGRAM_WIDTH}
          y={region.y * DIAGRAM_HEIGHT}
          width={region.width * DIAGRAM_WIDTH}
          height={region.height * DIAGRAM_HEIGHT}
          rx={region.rounded ? 4 : 1}
          fill={GLASS.has(region.panel) ? "#e2e8f0" : "none"}
          stroke="#98a2b3"
          strokeWidth={0.6}
        />
      ))}
      {marks
        .filter((mark) => mark.positionX !== null && mark.positionY !== null)
        .map((mark) => (
          <G key={mark.number}>
            <Circle
              cx={(mark.positionX as number) * DIAGRAM_WIDTH}
              cy={(mark.positionY as number) * DIAGRAM_HEIGHT}
              r={6}
              fill={SEVERITY_INK[mark.severity]}
              stroke="#ffffff"
              strokeWidth={1}
            />
            {/* The number is what ties a circle to its line in the list beside it. */}
            <SvgText
              x={(mark.positionX as number) * DIAGRAM_WIDTH}
              y={(mark.positionY as number) * DIAGRAM_HEIGHT + 2.5}
              textAnchor="middle"
              fill="#ffffff"
              // Size goes through `style`: as an SVG text prop it is not in the union
              // React-PDF's Text resolves to.
              style={{ fontSize: 7, fontWeight: 700 }}
            >
              {String(mark.number)}
            </SvgText>
          </G>
        ))}
    </Svg>
  );
}

export function HandoverPdf({
  data,
  labels,
  direction,
}: {
  data: HandoverPdfData;
  labels: HandoverPdfLabels;
  direction: "ltr" | "rtl";
}) {
  const { rtl, row, start, end, own } = directionStyles(direction);
  // Both footer lines are full-width and absolutely positioned, one aligned to each side.
  // Taken from `start` and `end` so they follow the document's direction: hand-rolled,
  // the Arabic pair both landed on the left and printed over each other.
  const footerStart = { textAlign: start.textAlign, direction } as const;
  const footerEnd = { textAlign: end.textAlign, direction } as const;

  const detail = (label: string, value: string, ownDirection = false) => (
    <View style={[row, styles.detailRow]}>
      <Text style={[styles.label, start]}>{label}</Text>
      <Text style={[styles.value, start, ownDirection ? own(value) : {}]}>{value}</Text>
    </View>
  );

  return (
    <Document title={`${data.title} ${data.contractNumber}`}>
      <Page size="A4" style={[styles.page, { fontFamily: pdfFontFamily(rtl) }]}>
        <View style={styles.body}>
          <Text style={[styles.title, start]}>{data.title}</Text>
          <Text style={[styles.subtitle, start, own(data.contractNumber)]}>
            {`${labels.contract} ${data.contractNumber}`}
          </Text>

          <View style={[row, { gap: 24 }]}>
            <View style={styles.panelBox}>
              <Text style={[styles.heading, start]}>{labels.customer}</Text>
              {detail(labels.customerCode, data.customer.code, true)}
              {detail("", data.customer.name)}
              {detail(labels.mobile, data.customer.mobile, true)}
            </View>
            <View style={styles.panelBox}>
              <Text style={[styles.heading, start]}>{labels.vehicle}</Text>
              {detail(labels.vehicleCode, data.vehicle.code, true)}
              {detail("", data.vehicle.description)}
              {detail(labels.plate, data.vehicle.plate, true)}
              {detail(labels.vin, data.vehicle.vin, true)}
            </View>
          </View>

          <View style={styles.section}>
            <View style={[row, { gap: 24 }]}>
              <View style={styles.panelBox}>{detail(labels.occurredAt, data.occurredAt, true)}</View>
              <View style={styles.panelBox}>{detail(labels.odometer, data.odometer, true)}</View>
              <View style={styles.panelBox}>{detail(labels.fuel, data.fuel, true)}</View>
            </View>
            {data.conditionNotes ? detail(labels.condition, data.conditionNotes) : null}
          </View>

          <View style={styles.section}>
            <Text style={[styles.heading, start]}>{labels.damage}</Text>
            <View style={[row, { gap: 20 }]}>
              <View>
                <Diagram marks={data.marks} />
                <Text style={[styles.muted, start, { fontSize: 8, marginTop: 4, width: DIAGRAM_WIDTH }]}>
                  {labels.diagramNote}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                {data.marks.length === 0 ? (
                  <Text style={[styles.muted, start]}>{labels.noDamage}</Text>
                ) : (
                  data.marks.map((mark) => (
                    <View key={mark.number} style={[row, styles.markRow]} wrap={false}>
                      <Text style={[styles.markNumber, start, { color: SEVERITY_INK[mark.severity] }]}>
                        {mark.number}
                      </Text>
                      <Text style={[styles.value, start]}>
                        {`${mark.panelLabel} · ${mark.severityLabel}${mark.note ? ` — ${mark.note}` : ""}`}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </View>
          </View>

          <View style={styles.section} wrap={false}>
            <Text style={[styles.heading, start]}>{labels.signatures}</Text>
            <View style={[row, { gap: 40 }]}>
              <View style={styles.signatureBox}>
                {data.customerSignature ? (
                  <Image src={data.customerSignature} style={styles.signatureImage} />
                ) : (
                  <Text style={[styles.muted, styles.signatureImage, start]}>{labels.unsigned}</Text>
                )}
                <Text style={[styles.signatureRule, start]}>{labels.customerSignature}</Text>
                <Text style={[styles.muted, start]}>{data.customerSignatureName ?? ""}</Text>
              </View>
              <View style={styles.signatureBox}>
                {data.staffSignature ? (
                  <Image src={data.staffSignature} style={styles.signatureImage} />
                ) : (
                  <Text style={[styles.muted, styles.signatureImage, start]}>{labels.unsigned}</Text>
                )}
                <Text style={[styles.signatureRule, start]}>{labels.staffSignature}</Text>
                <Text style={[styles.muted, start]}>{data.staffSignatureName ?? ""}</Text>
              </View>
            </View>
          </View>
        </View>

        <Text style={[styles.footer, footerStart]} fixed>
          {`${data.contractNumber} · ${labels.generated} ${data.generatedOn}`}
        </Text>
        <Text
          style={[styles.footer, footerEnd]}
          fixed
          render={({ pageNumber, totalPages }) => labels.page(pageNumber, totalPages ?? pageNumber)}
        />
      </Page>
    </Document>
  );
}
