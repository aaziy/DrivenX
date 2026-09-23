import { renderToBuffer } from "@react-pdf/renderer";
import { createTranslator } from "next-intl";

import { can } from "@drivenx/auth";
import { formatFuelEighths, severityRank } from "@drivenx/core";
import { handoverById } from "@drivenx/db";

import { intlLocale, isLocale, TIME_ZONE, type AppLocale } from "@/i18n/config";
import { currentLocale } from "@/i18n/locale";
import { currentPrincipal } from "@/lib/auth";
import {
  HandoverPdf,
  type HandoverPdfData,
  type HandoverPdfLabels,
  type HandoverPdfMark,
} from "@/lib/pdf/handover-pdf";
import { storage } from "@/lib/storage";

/**
 * The handover or return report as a PDF (P2-04), in the reader's language or the one
 * asked for — the person printing it is not always the person who signed it.
 *
 * The signatures are fetched from storage and embedded. A report that linked to them
 * would be a report that stops being evidence the moment it leaves this system, which is
 * the one thing it exists to survive.
 */

/** A stored PNG as a data URL, or null if it cannot be read. */
async function signatureImage(key: string | null): Promise<string | null> {
  if (!key) return null;
  try {
    const bytes = await storage().get(key);
    return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    // A missing signature file must not take the whole report down: the rest of the form
    // is still the record of what the car looked like.
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ contractId: string; handoverId: string }> },
) {
  const principal = await currentPrincipal();
  if (!principal) return new Response(null, { status: 401 });
  if (!can(principal, "handover.view")) return new Response(null, { status: 403 });

  const { contractId, handoverId } = await params;
  const asked = new URL(request.url).searchParams.get("lang");
  const locale: AppLocale = isLocale(asked) ? asked : await currentLocale();

  const handover = await handoverById(handoverId);
  if (!handover || handover.contractId !== contractId) return new Response(null, { status: 404 });

  const messages = (await import(`../../../../../../../../messages/${locale}.json`)).default;
  const tag = intlLocale(locale);
  const translator = (namespace: string) =>
    createTranslator({ locale: tag, messages, namespace: namespace as never, timeZone: TIME_ZONE });
  const t = translator("handovers") as unknown as (key: string, values?: Record<string, unknown>) => string;
  const tr = (namespace: string, key: string) =>
    (translator(namespace) as unknown as (key: string) => string)(key);

  const moment = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short", timeZone: TIME_ZONE });
  const day = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeZone: TIME_ZONE });

  const { contract } = handover;
  const { customer, vehicle } = contract;

  // Worst first: a return report is read to find what has to be settled.
  const marks: HandoverPdfMark[] = [...handover.damagePoints]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .map((point, index) => ({
      number: index + 1,
      panelLabel: t(`panels.${point.panel}`),
      severity: point.severity,
      severityLabel: t(`severity.${point.severity}`),
      note: point.note,
      positionX: point.positionX,
      positionY: point.positionY,
    }));

  const [customerSignature, staffSignature] = await Promise.all([
    signatureImage(handover.customerSignatureKey),
    signatureImage(handover.staffSignatureKey),
  ]);

  const data: HandoverPdfData = {
    title: t(handover.type === "HANDOVER" ? "handoverTitle" : "returnTitle"),
    contractNumber: contract.number,
    generatedOn: day.format(new Date()),
    occurredAt: moment.format(handover.occurredAt),
    customer: { name: customer.fullName, code: customer.code, mobile: customer.mobile },
    vehicle: {
      description: `${vehicle.make} ${vehicle.model} ${vehicle.year}`,
      code: vehicle.code,
      plate: `${tr("vehicles.emirates", vehicle.plateEmirate)} ${vehicle.plateCode} ${vehicle.plateNumber}`,
      vin: vehicle.vin,
    },
    odometer: t("km", { km: handover.odometerKm }),
    fuel: formatFuelEighths(handover.fuelEighths),
    conditionNotes: handover.conditionNotes,
    marks,
    customerSignature,
    customerSignatureName: handover.customerSignatureName,
    staffSignature,
    staffSignatureName: handover.staffSignatureName,
  };

  const tp = translator("handoverPdf") as unknown as (key: string, values?: Record<string, unknown>) => string;
  const keys = [
    "contract", "customer", "vehicle", "customerCode", "mobile", "vehicleCode", "plate", "vin",
    "occurredAt", "odometer", "fuel", "condition", "damage", "noDamage", "diagramNote",
    "signatures", "customerSignature", "staffSignature", "unsigned", "generated",
  ] as const;
  const labels = {
    ...Object.fromEntries(keys.map((key) => [key, tp(key)])),
    page: (current: number, total: number) => tp("page", { current, total }),
  } as HandoverPdfLabels;

  const pdf = await renderToBuffer(
    HandoverPdf({ data, labels, direction: locale === "ar" ? "rtl" : "ltr" }),
  );

  const suffix = handover.type === "HANDOVER" ? "handover" : "return";
  const fileName = `${contract.number}-${suffix}${locale === "ar" ? "-ar" : ""}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
      "Content-Disposition": `inline; filename="${fileName}"`,
      // It carries a customer's contact details and their signature.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
