import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { Money } from "@drivenx/core";
import { prisma } from "@drivenx/db";

import { SubmitButton } from "@/components/form";
import { requirePermission } from "@/lib/auth";

import { installmentStatusTone } from "../../contracts/tone";
import { DocumentsCard } from "../../documents/documents-card";
import { deleteSupplier, setSupplierStatus, updateSupplier } from "../actions";
import { SupplierForm } from "../supplier-form";

const STATUSES = ["ACTIVE", "INACTIVE", "BLACKLISTED"] as const;

async function loadSupplier(supplierId: string) {
  return prisma.supplier.findFirst({ where: { id: supplierId, deletedAt: null } });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}): Promise<Metadata> {
  const supplier = await loadSupplier((await params).supplierId);
  return { title: supplier ? `${supplier.companyName} · DrivenX` : "DrivenX" };
}

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  const principal = await requirePermission("supplier.view");
  const { supplierId } = await params;

  const canSeePayables = principal.permissions.has("supplier_invoice.view");

  const [t, tStatements, tInstallment, format, supplier, payables] = await Promise.all([
    getTranslations("suppliers"),
    getTranslations("statements"),
    getTranslations("contracts.installmentStatus"),
    getFormatter(),
    loadSupplier(supplierId),
    // What is owed now: raised and not settled. Months not yet due are not a debt.
    canSeePayables
      ? prisma.supplierInvoice.findMany({
          where: { supplierId, raisedOn: { not: null }, status: { not: "PAID" } },
          orderBy: [{ dueDate: "asc" }, { sequence: "asc" }],
          include: { contract: { select: { id: true, number: true } } },
        })
      : [],
  ]);

  if (!supplier) notFound();

  const canUpdate = principal.permissions.has("supplier.update");
  const canDelete = principal.permissions.has("supplier.delete");

  const statusLabel = (value: (typeof STATUSES)[number]) =>
    ({
      ACTIVE: t("status.active"),
      INACTIVE: t("status.inactive"),
      BLACKLISTED: t("status.blacklisted"),
    })[value];

  return (
    <>
      <header className="page-header">
        <div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            <Link href="/suppliers">{t("detail.back")}</Link>
          </p>
          <h1>{supplier.companyName}</h1>
          <p className="page-subtitle">
            <bdi>{supplier.code}</bdi> · {statusLabel(supplier.status)}
          </p>
        </div>
        {principal.permissions.has("supplier_invoice.view") ? (
          <Link className="btn-secondary" href={`/suppliers/${supplier.id}/statement`}>
            {tStatements("open")}
          </Link>
        ) : null}
      </header>

      <div className="page-body stack">
        <div className="card">
          <div className="card-header">
            <h2>{t("detail.editTitle")}</h2>
          </div>
          <div className="card-body">
            {canUpdate ? (
              <SupplierForm
                action={updateSupplier.bind(null, supplier.id)}
                submitLabelKey="save"
                defaults={{
                  companyName: supplier.companyName,
                  contactPerson: supplier.contactPerson ?? "",
                  phone: supplier.phone ?? "",
                  email: supplier.email ?? "",
                  address: supplier.address ?? "",
                  tradeLicenseNo: supplier.tradeLicenseNo ?? "",
                  trn: supplier.trn ?? "",
                  bankName: supplier.bankName ?? "",
                  bankAccountName: supplier.bankAccountName ?? "",
                  iban: supplier.iban ?? "",
                  notes: supplier.notes ?? "",
                }}
              />
            ) : (
              <p className="muted">{t("detail.readOnly")}</p>
            )}
          </div>
        </div>

        {canSeePayables ? (
          <div className="card">
            <div className="card-header">
              <h2>{t("payables.title")}</h2>
              <span className="muted">
                {t("payables.outstanding", {
                  amount: Money.format(payables.reduce((sum, item) => sum + item.amountFils - item.paidFils, 0n)),
                })}
              </span>
            </div>
            {payables.length === 0 ? (
              <div className="card-body">
                <p className="muted">{t("payables.empty")}</p>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t("payables.columns.contract")}</th>
                      <th>{t("payables.columns.due")}</th>
                      <th className="numeric">{t("payables.columns.amount")}</th>
                      <th className="numeric">{t("payables.columns.paid")}</th>
                      <th>{t("payables.columns.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payables.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <Link href={`/contracts/${item.contract.id}`}>
                            <bdi>{item.contract.number}</bdi>
                          </Link>
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {format.dateTime(item.dueDate, { dateStyle: "medium", timeZone: "UTC" })}
                        </td>
                        <td className="numeric">{Money.format(item.amountFils, { currency: null })}</td>
                        <td className="numeric">{Money.format(item.paidFils, { currency: null })}</td>
                        <td>
                          <span className={`badge ${installmentStatusTone(item.status)}`.trim()}>
                            {tInstallment(item.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        {principal.permissions.has("document.view") ? (
          <DocumentsCard
            ownerType="SUPPLIER"
            ownerId={supplier.id}
            canUpload={principal.permissions.has("document.upload")}
            canDelete={principal.permissions.has("document.delete")}
          />
        ) : null}

        {canUpdate ? (
          <div className="card">
            <div className="card-header">
              <h2>{t("detail.statusTitle")}</h2>
            </div>
            <div className="card-body">
              <p className="muted">{t("detail.statusHint")}</p>
              <form
                action={setSupplierStatus.bind(null, supplier.id)}
                className="row"
                style={{ gap: 12, alignItems: "end" }}
              >
                <div className="field" style={{ flex: "0 1 220px", marginBottom: 0 }}>
                  <label htmlFor="status">{t("columns.status")}</label>
                  <select id="status" name="status" defaultValue={supplier.status}>
                    {STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {statusLabel(value)}
                      </option>
                    ))}
                  </select>
                </div>
                <SubmitButton pendingLabel={t("detail.saving")}>
                  {t("detail.changeStatus")}
                </SubmitButton>
              </form>
            </div>
          </div>
        ) : null}

        {canDelete ? (
          <div className="card">
            <div className="card-header">
              <h2>{t("detail.dangerTitle")}</h2>
            </div>
            <div className="card-body">
              <p className="muted">{t("detail.dangerHint")}</p>
              <form action={deleteSupplier.bind(null, supplier.id)}>
                <SubmitButton variant="secondary" pendingLabel={t("detail.deleting")}>
                  {t("detail.delete")}
                </SubmitButton>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
