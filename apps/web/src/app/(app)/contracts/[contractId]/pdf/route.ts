import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { createTranslator } from "next-intl";

import { can } from "@drivenx/auth";
import { buildSchedule, businessDate, Money, type ChargeType } from "@drivenx/core";
import { fromDbDate, prisma } from "@drivenx/db";

import { intlLocale, isLocale, TIME_ZONE, type AppLocale } from "@/i18n/config";
import { currentLocale } from "@/i18n/locale";
import { currentPrincipal } from "@/lib/auth";
import { ContractPdf, type ContractPdfData, type ContractPdfLabels, type ContractPdfRow } from "@/lib/pdf/contract-pdf";

/**
 * The contract as a PDF (P1D-18), in the reader's language or the one asked for.
 *
 * `?lang=ar` gives the Arabic document to an English-speaking user and the reverse, since
 * the person printing it is not always the person signing it. Like document downloads,
 * this answers with status codes rather than pages, and nothing is cached.
 */
export async function GET(request: Request, { params }: { params: Promise<{ contractId: string }> }) {
  const principal = await currentPrincipal();
  if (!principal) return new Response(null, { status: 401 });
  if (!can(principal, "contract.view")) return new Response(null, { status: 403 });

  const { contractId } = await params;
  const asked = new URL(request.url).searchParams.get("lang");
  const locale: AppLocale = isLocale(asked) ? asked : await currentLocale();

  const contract = await prisma.contract.findFirst({
    where: { id: contractId, deletedAt: null },
    include: {
      customer: true,
      vehicle: true,
      installments: {
        orderBy: [{ dueDate: "asc" }, { sequence: "asc" }],
        include: { charge: { select: { chargeType: true } } },
      },
    },
  });
  if (!contract) return new Response(null, { status: 404 });

  const messages = (await import(`../../../../../../messages/${locale}.json`)).default;
  const tag = intlLocale(locale);
  const translator = (namespace: string) =>
    createTranslator({ locale: tag, messages, namespace: namespace as never, timeZone: TIME_ZONE });
  const t = translator("contractPdf") as unknown as (key: string, values?: Record<string, unknown>) => string;
  const tr = (namespace: string, key: string) =>
    (translator(namespace) as unknown as (key: string) => string)(key);

  // Calendar dates are stored at UTC midnight and formatted in UTC, so no zone moves the day.
  const day = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeZone: "UTC" });
  const date = (value: Date) => day.format(value);
  const amount = (fils: bigint) => Money.format(fils, { currency: null });

  // An active contract prints its real schedule, invoice numbers and all. A draft prints
  // what activation would write, from the same function activation uses.
  const lines =
    contract.installments.length > 0
      ? contract.installments.map((item) => ({
          dueDate: item.dueDate,
          chargeType: item.charge.chargeType as ChargeType,
          invoice: item.invoiceNumber,
          netFils: item.netFils,
          vatFils: item.vatFils,
          grossFils: item.grossFils,
          waived: item.waivedAt !== null,
        }))
      : buildSchedule({
          startDate: fromDbDate(contract.startDate),
          durationMonths: contract.durationMonths,
          monthlyRental: contract.monthlyRentalFils,
          downPayment: contract.downPaymentFils,
          buyout: contract.buyoutFils,
          annualInsurance: contract.annualInsuranceFils,
          vatBasisPoints: contract.vatBasisPoints,
        }).map((item) => ({
          dueDate: new Date(`${item.dueDate}T00:00:00Z`),
          chargeType: item.chargeType,
          invoice: null,
          netFils: item.netFils,
          vatFils: item.vatFils,
          grossFils: item.grossFils,
          waived: false,
        }));

  const rows: ContractPdfRow[] = lines.map((item) => ({
    due: date(item.dueDate),
    charge: tr("contracts.charges", item.chargeType),
    invoice: item.invoice,
    net: amount(item.netFils),
    vat: amount(item.vatFils),
    gross: amount(item.grossFils),
    waived: item.waived,
  }));

  // A waived line is shown, marked, and left out of what is owed.
  const totals = lines
    .filter((item) => !item.waived)
    .reduce(
      (sum, item) => ({ net: sum.net + item.netFils, vat: sum.vat + item.vatFils, gross: sum.gross + item.grossFils }),
      { net: 0n, vat: 0n, gross: 0n },
    );

  const terms: ContractPdfData["terms"] = [
    { label: t("term"), value: `${date(contract.startDate)} – ${date(contract.endDate)}` },
    { label: t("months"), value: String(contract.durationMonths) },
    { label: t("monthlyRental"), value: Money.format(contract.monthlyRentalFils) },
  ];
  if (contract.downPaymentFils > 0n) terms.push({ label: t("downPayment"), value: Money.format(contract.downPaymentFils) });
  if (contract.annualInsuranceFils > 0n) {
    terms.push({ label: t("annualInsurance"), value: Money.format(contract.annualInsuranceFils) });
  }
  if (contract.buyoutFils > 0n) terms.push({ label: t("buyout"), value: Money.format(contract.buyoutFils) });
  terms.push({ label: t("vatRate"), value: t("vatValue", { rate: contract.vatBasisPoints / 100 }) });
  if (contract.mileageAllowanceKm !== null) {
    terms.push({ label: t("mileageAllowance"), value: t("mileageValue", { km: contract.mileageAllowanceKm }) });
  }
  if (contract.excessMileageRateFils !== null) {
    terms.push({
      label: t("excessMileageRate"),
      value: t("excessValue", { amount: Money.format(contract.excessMileageRateFils) }),
    });
  }

  const { customer, vehicle } = contract;
  const data: ContractPdfData = {
    number: contract.number,
    typeLabel: tr("contracts.types", contract.type),
    statusLabel: tr("contracts.status", contract.status),
    draft: contract.status === "DRAFT" || contract.status === "PENDING",
    generatedOn: date(new Date(`${businessDate(new Date())}T00:00:00Z`)),
    customer: {
      name: customer.fullName,
      code: customer.code,
      mobile: customer.mobile,
      email: customer.email,
      address: [customer.addressLine, customer.city].filter(Boolean).join(", ") || null,
    },
    vehicle: {
      description: `${vehicle.make} ${vehicle.model} ${vehicle.year}`,
      code: vehicle.code,
      plate: `${tr("vehicles.emirates", vehicle.plateEmirate)} ${vehicle.plateCode} ${vehicle.plateNumber}`,
      vin: vehicle.vin,
      colour: vehicle.colour,
    },
    terms,
    schedule: rows,
    totals: { net: amount(totals.net), vat: amount(totals.vat), gross: amount(totals.gross) },
    notes: contract.terms,
  };

  const keys = [
    "title", "draftBanner", "customer", "vehicle", "customerCode", "mobile", "email", "address",
    "vehicleCode", "plate", "vin", "colour", "terms", "schedule", "due", "charge", "invoice", "net",
    "vat", "gross", "total", "waived", "notes", "vatNote", "signatures", "customerSignature",
    "companySignature", "nameAndDate", "generated",
  ] as const;
  const labels = {
    ...Object.fromEntries(keys.map((key) => [key, t(key)])),
    page: (current: number, total: number) => t("page", { current, total }),
  } as ContractPdfLabels;

  const pdf = await renderToBuffer(
    createElement(ContractPdf, { data, labels, direction: locale === "ar" ? "rtl" : "ltr" }),
  );

  const fileName = `${contract.number}${locale === "ar" ? "-ar" : ""}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
      "Content-Disposition": `inline; filename="${fileName}"`,
      // It carries a customer's contact details; no shared cache should keep a copy.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
