import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { prisma } from "@drivenx/db";

import { SubmitButton } from "@/components/form";
import { requirePermission } from "@/lib/auth";

import { DocumentsCard } from "../../documents/documents-card";
import { deleteCustomer, setCustomerStatus, updateCustomer } from "../actions";
import { CustomerForm } from "../customer-form";

const STATUSES = ["ACTIVE", "INACTIVE", "BLACKLISTED"] as const;

async function loadCustomer(customerId: string) {
  return prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ customerId: string }>;
}): Promise<Metadata> {
  const customer = await loadCustomer((await params).customerId);
  return { title: customer ? `${customer.fullName} · DrivenX` : "DrivenX" };
}

/** `<input type="date">` wants YYYY-MM-DD, never a localised date. */
function dateInputValue(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const principal = await requirePermission("customer.view");
  const { customerId } = await params;

  const [t, customer] = await Promise.all([
    getTranslations("customers"),
    loadCustomer(customerId),
  ]);

  if (!customer) notFound();

  const canUpdate = principal.permissions.has("customer.update");
  const canDelete = principal.permissions.has("customer.delete");

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
            <Link href="/customers">{t("detail.back")}</Link>
          </p>
          <h1>{customer.fullName}</h1>
          <p className="page-subtitle">
            <bdi>{customer.code}</bdi> · {statusLabel(customer.status)}
          </p>
        </div>
      </header>

      <div className="page-body stack">
        <div className="card">
          <div className="card-header">
            <h2>{t("detail.editTitle")}</h2>
          </div>
          <div className="card-body">
            {canUpdate ? (
              <CustomerForm
                action={updateCustomer.bind(null, customer.id)}
                submitLabelKey="save"
                defaults={{
                  fullName: customer.fullName,
                  mobile: customer.mobile,
                  email: customer.email ?? "",
                  dateOfBirth: dateInputValue(customer.dateOfBirth),
                  nationality: customer.nationality ?? "",
                  addressLine: customer.addressLine ?? "",
                  city: customer.city ?? "",
                  emergencyName: customer.emergencyName ?? "",
                  emergencyPhone: customer.emergencyPhone ?? "",
                  notes: customer.notes ?? "",
                }}
              />
            ) : (
              <p className="muted">{t("detail.readOnly")}</p>
            )}
          </div>
        </div>

        {principal.permissions.has("document.view") ? (
          <DocumentsCard
            ownerType="CUSTOMER"
            ownerId={customer.id}
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
                action={setCustomerStatus.bind(null, customer.id)}
                className="row"
                style={{ gap: 12, alignItems: "end" }}
              >
                <div className="field" style={{ flex: "0 1 220px", marginBottom: 0 }}>
                  <label htmlFor="status">{t("columns.status")}</label>
                  <select id="status" name="status" defaultValue={customer.status}>
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
              {/* Soft delete: contracts, payments and ledger entries reference this row,
                  so it is hidden rather than removed. */}
              <p className="muted">{t("detail.dangerHint")}</p>
              <form action={deleteCustomer.bind(null, customer.id)}>
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
