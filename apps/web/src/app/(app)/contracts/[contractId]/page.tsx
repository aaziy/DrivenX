import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { businessDate, EDITABLE_CONTRACT_STATUSES, Money, type ContractStatus } from "@drivenx/core";
import { prisma } from "@drivenx/db";

import { requirePermission } from "@/lib/auth";

import { DocumentsCard } from "../../documents/documents-card";
import { activateContractAction, recordPaymentAction, waiveInstallmentAction } from "../actions";
import { contractStatusTone, installmentStatusTone } from "../tone";
import { ActivateForm, PaymentForm, WaiveForm } from "./panels";

async function loadContract(contractId: string) {
  return prisma.contract.findFirst({
    where: { id: contractId, deletedAt: null },
    include: {
      customer: { select: { id: true, code: true, fullName: true, mobile: true } },
      vehicle: { select: { id: true, code: true, make: true, model: true, plateCode: true, plateNumber: true } },
      supplier: { select: { id: true, companyName: true } },
      installments: {
        orderBy: [{ dueDate: "asc" }, { sequence: "asc" }],
        include: { charge: { select: { chargeType: true } } },
      },
      payments: { orderBy: { receivedOn: "desc" }, include: { recordedBy: { select: { fullName: true } } } },
      statusChanges: { orderBy: { changedAt: "desc" }, include: { changedBy: { select: { fullName: true } } } },
    },
  });
}

export async function generateMetadata({ params }: { params: Promise<{ contractId: string }> }): Promise<Metadata> {
  const contract = await loadContract((await params).contractId);
  return { title: contract ? `${contract.number} · DrivenX` : "DrivenX" };
}

export default async function ContractPage({ params }: { params: Promise<{ contractId: string }> }) {
  const principal = await requirePermission("contract.view");
  const { contractId } = await params;

  const [t, tStatus, tTypes, tInstallment, tCharges, tMethods, format, contract, revenue] = await Promise.all([
    getTranslations("contracts"),
    getTranslations("contracts.status"),
    getTranslations("contracts.types"),
    getTranslations("contracts.installmentStatus"),
    getTranslations("contracts.charges"),
    getTranslations("contracts.methods"),
    getFormatter(),
    loadContract(contractId),
    prisma.ledgerEntry.groupBy({
      by: ["category"],
      where: { contractId, direction: "REVENUE" },
      _sum: { amountFils: true },
    }),
  ]);

  if (!contract) notFound();

  const can = (key: Parameters<typeof principal.permissions.has>[0]) => principal.permissions.has(key);
  const today = businessDate(new Date());
  // DATE columns come back at UTC midnight; format them in UTC so no zone shifts the day.
  const day = (date: Date) => format.dateTime(date, { dateStyle: "medium", timeZone: "UTC" });

  const live = contract.status === "ACTIVE" || contract.status === "OVERDUE";
  const scheduled = contract.installments.reduce(
    (totals, item) => ({
      gross: totals.gross + (item.waivedAt ? 0n : item.grossFils),
      paid: totals.paid + item.paidFils,
    }),
    { gross: 0n, paid: 0n },
  );
  const outstanding = scheduled.gross - scheduled.paid;
  const bookedRevenue = revenue.reduce((sum, row) => sum + (row._sum.amountFils ?? 0n), 0n);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            <Link href="/contracts">{t("detail.back")}</Link>
          </p>
          <h1>
            <bdi>{contract.number}</bdi>{" "}
            <span className={`badge ${contractStatusTone(contract.status)}`.trim()} style={{ verticalAlign: "middle" }}>
              {tStatus(contract.status)}
            </span>
          </h1>
          <p className="page-subtitle">
            {tTypes(contract.type)} · <Link href={`/customers/${contract.customer.id}`}>{contract.customer.fullName}</Link>
            {" · "}
            <Link href={`/vehicles/${contract.vehicle.id}`}>
              <bdi>
                {contract.vehicle.make} {contract.vehicle.model} {contract.vehicle.plateCode} {contract.vehicle.plateNumber}
              </bdi>
            </Link>
          </p>
        </div>
      </header>

      <div className="page-body stack">
        <div className="card">
          <div className="card-header">
            <h2>{t("detail.summaryTitle")}</h2>
          </div>
          <div className="card-body">
            <table className="deal-table" style={{ maxWidth: 560 }}>
              <tbody>
                <tr><td>{t("detail.term")}</td><td>{day(contract.startDate)} – {day(contract.endDate)}</td></tr>
                <tr><td>{t("detail.months")}</td><td>{contract.durationMonths}</td></tr>
                <tr><td>{t("detail.monthlyRental")}</td><td>{Money.format(contract.monthlyRentalFils)}</td></tr>
                {contract.downPaymentFils > 0n ? (
                  <tr><td>{t("detail.downPayment")}</td><td>{Money.format(contract.downPaymentFils)}</td></tr>
                ) : null}
                {contract.annualInsuranceFils > 0n ? (
                  <tr><td>{t("detail.annualInsurance")}</td><td>{Money.format(contract.annualInsuranceFils)}</td></tr>
                ) : null}
                {contract.buyoutFils > 0n ? (
                  <tr><td>{t("detail.buyout")}</td><td>{Money.format(contract.buyoutFils)}</td></tr>
                ) : null}
                {live || contract.status === "COMPLETED" ? (
                  <>
                    <tr className="deal-total"><td>{t("detail.scheduledGross")}</td><td>{Money.format(scheduled.gross)}</td></tr>
                    <tr><td>{t("detail.paid")}</td><td>{Money.format(scheduled.paid)}</td></tr>
                    <tr className="deal-total">
                      <td>{t("detail.outstanding")}</td>
                      <td className={contract.status === "OVERDUE" ? "negative" : ""}>{Money.format(outstanding)}</td>
                    </tr>
                    <tr><td>{t("detail.revenueBooked")}</td><td>{Money.format(bookedRevenue)}</td></tr>
                  </>
                ) : null}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 12.5, marginBlockStart: 10 }}>{t("detail.vatNote")}</p>

            {EDITABLE_CONTRACT_STATUSES.includes(contract.status as ContractStatus) && can("contract.activate") ? (
              <div style={{ marginBlockStart: 14 }}>
                <p className="muted">{t("detail.activateHint")}</p>
                <ActivateForm action={activateContractAction.bind(null, contract.id)} />
              </div>
            ) : null}
          </div>
        </div>

        {contract.installments.length > 0 ? (
          <div className="card">
            <div className="card-header">
              <h2>{t("detail.scheduleTitle")}</h2>
              <span className="muted">{t("detail.installmentCount", { count: contract.installments.length })}</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>{t("schedule.due")}</th>
                    <th>{t("schedule.charge")}</th>
                    <th>{t("schedule.invoice")}</th>
                    <th className="numeric">{t("schedule.net")}</th>
                    <th className="numeric">{t("schedule.vat")}</th>
                    <th className="numeric">{t("schedule.gross")}</th>
                    <th className="numeric">{t("schedule.paid")}</th>
                    <th>{t("schedule.status")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {contract.installments.map((item) => (
                    <tr key={item.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{day(item.dueDate)}</td>
                      <td>{tCharges(item.charge.chargeType)}</td>
                      <td className="muted">{item.invoiceNumber ? <bdi>{item.invoiceNumber}</bdi> : "—"}</td>
                      <td className="numeric" style={{ whiteSpace: "nowrap" }}>{Money.format(item.netFils, { currency: null })}</td>
                      <td className="numeric muted" style={{ whiteSpace: "nowrap" }}>{Money.format(item.vatFils, { currency: null })}</td>
                      <td className="numeric" style={{ whiteSpace: "nowrap" }}>{Money.format(item.grossFils, { currency: null })}</td>
                      <td className="numeric" style={{ whiteSpace: "nowrap" }}>{Money.format(item.paidFils, { currency: null })}</td>
                      <td>
                        <span className={`badge ${installmentStatusTone(item.status)}`.trim()}>{tInstallment(item.status)}</span>
                        {item.waiveReason ? (
                          <div className="muted" style={{ fontSize: 12 }}><bdi>{item.waiveReason}</bdi></div>
                        ) : null}
                      </td>
                      <td>
                        {live && can("payment.waive") && !item.waivedAt && item.paidFils === 0n ? (
                          <WaiveForm action={waiveInstallmentAction.bind(null, contract.id, item.id)} />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {live && can("payment.record") ? (
          <div className="card">
            <div className="card-header">
              <h2>{t("payment.title")}</h2>
            </div>
            <div className="card-body">
              <PaymentForm action={recordPaymentAction.bind(null, contract.id)} today={today} />
            </div>
          </div>
        ) : null}

        {contract.payments.length > 0 && can("payment.view") ? (
          <div className="card">
            <div className="card-header">
              <h2>{t("detail.paymentsTitle")}</h2>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="data">
                <tbody>
                  {contract.payments.map((payment) => (
                    <tr key={payment.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{day(payment.receivedOn)}</td>
                      <td style={{ fontWeight: 560, whiteSpace: "nowrap" }}>{Money.format(payment.amountFils)}</td>
                      <td className="muted">{tMethods(payment.method)}</td>
                      <td className="muted">{payment.reference ? <bdi>{payment.reference}</bdi> : null}</td>
                      <td className="muted">
                        {payment.creditFils > 0n ? t("detail.credit", { amount: Money.format(payment.creditFils) }) : null}
                      </td>
                      <td className="muted">{payment.recordedBy ? t("detail.by", { name: payment.recordedBy.fullName }) : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {can("document.view") ? (
          <DocumentsCard
            ownerType="CONTRACT"
            ownerId={contract.id}
            canUpload={can("document.upload")}
            canDelete={can("document.delete")}
          />
        ) : null}

        <div className="card">
          <div className="card-header">
            <h2>{t("detail.historyTitle")}</h2>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="data">
              <tbody>
                {contract.statusChanges.map((change) => (
                  <tr key={change.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {format.dateTime(change.changedAt, { dateStyle: "medium", timeStyle: "short" })}
                    </td>
                    <td style={{ fontWeight: 560 }}>
                      {change.fromStatus === null
                        ? t("detail.drafted")
                        : t("detail.changed", { from: tStatus(change.fromStatus), to: tStatus(change.toStatus) })}
                    </td>
                    <td className="muted">{change.changedBy ? t("detail.by", { name: change.changedBy.fullName }) : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
