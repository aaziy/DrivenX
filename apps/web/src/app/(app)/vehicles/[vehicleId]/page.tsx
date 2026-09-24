import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { allowedTransitions, CONTRACT_MANAGED_STATUSES, isTerminal, Money } from "@drivenx/core";
import { prisma } from "@drivenx/db";

import { requirePermission } from "@/lib/auth";

import { DocumentsCard } from "../../documents/documents-card";
import { InsuranceCard } from "../insurance-card";
import { AccidentsCard } from "../accidents-card";
import { FinesCard } from "../fines-card";
import { MaintenanceCard } from "../maintenance-card";
import {
  changeVehicleStatusAction,
  deleteVehicleAction,
  recordMileageAction,
  updateVehicleAction,
} from "../actions";
import { vehicleStatusTone } from "../tone";
import { VehicleForm } from "../vehicle-form";
import { DeleteVehicleForm, MileageForm, StatusForm } from "./vehicle-panels";

async function loadVehicle(vehicleId: string) {
  return prisma.vehicle.findFirst({
    where: { id: vehicleId, deletedAt: null },
    include: {
      supplier: { select: { id: true, code: true, companyName: true } },
      statusChanges: {
        orderBy: { changedAt: "desc" },
        take: 30,
        include: { changedBy: { select: { fullName: true } } },
      },
      mileageReadings: {
        orderBy: { readAt: "desc" },
        take: 10,
        include: { recordedBy: { select: { fullName: true } } },
      },
    },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ vehicleId: string }>;
}): Promise<Metadata> {
  const vehicle = await loadVehicle((await params).vehicleId);
  return { title: vehicle ? `${vehicle.code} · DrivenX` : "DrivenX" };
}

/** YYYY-MM-DD for `<input type="date">`, never a localised date. */
const dateInput = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "");

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ vehicleId: string }>;
}) {
  const principal = await requirePermission("vehicle.view");
  const { vehicleId } = await params;

  const [t, tStatus, tOwnership, tEmirates, format, vehicle, suppliers] = await Promise.all([
    getTranslations("vehicles"),
    getTranslations("vehicles.status"),
    getTranslations("vehicles.ownership"),
    getTranslations("vehicles.emirates"),
    getFormatter(),
    loadVehicle(vehicleId),
    prisma.supplier.findMany({
      where: { deletedAt: null },
      orderBy: { companyName: "asc" },
      select: { id: true, code: true, companyName: true },
    }),
  ]);

  if (!vehicle) notFound();

  const can = (key: Parameters<typeof principal.permissions.has>[0]) => principal.permissions.has(key);
  const canUpdate = can("vehicle.update");

  const cost =
    vehicle.ownershipType === "COMPANY_OWNED"
      ? vehicle.purchasePriceFils
      : vehicle.supplierMonthlyCostFils;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            <Link href="/vehicles">{t("detail.back")}</Link>
          </p>
          <h1>
            <bdi>
              {vehicle.make} {vehicle.model}
            </bdi>{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              {vehicle.year}
            </span>
          </h1>
          <p className="page-subtitle row" style={{ gap: 10, alignItems: "center" }}>
            <bdi>{vehicle.code}</bdi>
            <span>·</span>
            <bdi>
              {vehicle.plateCode} {vehicle.plateNumber}
            </bdi>
            <span>{tEmirates(vehicle.plateEmirate)}</span>
            <span className={`badge ${vehicleStatusTone(vehicle.status)}`.trim()}>
              {tStatus(vehicle.status)}
            </span>
          </p>
        </div>
      </header>

      <div className="page-body stack">
        <div className="card">
          <div className="card-header">
            <h2>{t("detail.statusTitle")}</h2>
            <span className="muted">
              {tOwnership(vehicle.ownershipType)}
              {vehicle.supplier ? ` · ${vehicle.supplier.companyName}` : ""}
              {cost !== null ? ` · ${Money.format(cost)}` : ""}
            </span>
          </div>
          <div className="card-body">
            {isTerminal(vehicle.status) ? (
              <p className="muted">{t("detail.terminal")}</p>
            ) : can("vehicle.transition") ? (
              <>
                <p className="muted">
                  {t("detail.statusHint")} {t("detail.contractManagedHint")}
                  {vehicle.ownershipType === "B2B_SUPPLIER" ? ` ${t("detail.leasedHint")}` : ""}
                </p>
                <StatusForm
                  action={changeVehicleStatusAction.bind(null, vehicle.id)}
                  // Rented and Lease-to-own come from activating a contract (INV-9), so they
                  // are never offered here even where the state machine allows them.
                  options={allowedTransitions(vehicle.status, vehicle.ownershipType).filter(
                    (status) => !CONTRACT_MANAGED_STATUSES.includes(status),
                  )}
                />
              </>
            ) : null}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>{t("detail.mileageTitle")}</h2>
            <span className="muted">
              {t("detail.current")}: <bdi>{t("km", { km: vehicle.currentMileageKm })}</bdi>
            </span>
          </div>
          {canUpdate && !isTerminal(vehicle.status) ? (
            <div className="card-body">
              <MileageForm action={recordMileageAction.bind(null, vehicle.id)} />
            </div>
          ) : null}
          {vehicle.mileageReadings.length === 0 ? (
            <div className="card-body">
              <p className="muted">{t("detail.noReadings")}</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data">
                <tbody>
                  {vehicle.mileageReadings.map((reading) => (
                    <tr key={reading.id}>
                      <td style={{ fontWeight: 560 }}>
                        <bdi>{t("km", { km: reading.readingKm })}</bdi>
                      </td>
                      <td className="muted">
                        <time dateTime={reading.readAt.toISOString()}>
                          {format.dateTime(reading.readAt, { dateStyle: "medium" })}
                        </time>
                      </td>
                      <td className="muted">{reading.note ? <bdi>{reading.note}</bdi> : null}</td>
                      <td className="muted">
                        {reading.recordedBy ? t("detail.by", { name: reading.recordedBy.fullName }) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {can("maintenance.view") ? (
          <MaintenanceCard
            vehicleId={vehicle.id}
            odometerKm={vehicle.currentMileageKm}
            canManage={can("maintenance.manage")}
          />
        ) : null}

        {can("fine.view") ? <FinesCard vehicleId={vehicle.id} canManage={can("fine.manage")} /> : null}

        {can("accident.view") ? (
          <AccidentsCard
            vehicleId={vehicle.id}
            canManage={can("accident.manage")}
            canSeeDocuments={can("document.view")}
            canUpload={can("document.upload")}
            canDelete={can("document.delete")}
          />
        ) : null}

        {can("insurance.view") ? (
          <InsuranceCard vehicleId={vehicle.id} canManage={can("insurance.manage")} />
        ) : null}

        {can("document.view") ? (
          <DocumentsCard
            ownerType="VEHICLE"
            ownerId={vehicle.id}
            canUpload={can("document.upload")}
            canDelete={can("document.delete")}
          />
        ) : null}

        <div className="card">
          <div className="card-header">
            <h2>{t("detail.detailsTitle")}</h2>
          </div>
          <div className="card-body">
            {canUpdate ? (
              <VehicleForm
                action={updateVehicleAction.bind(null, vehicle.id)}
                mode="edit"
                suppliers={suppliers.map((s) => ({ id: s.id, label: `${s.companyName} (${s.code})` }))}
                defaults={{
                  make: vehicle.make,
                  model: vehicle.model,
                  year: String(vehicle.year),
                  variant: vehicle.variant ?? "",
                  colour: vehicle.colour ?? "",
                  plateEmirate: vehicle.plateEmirate,
                  plateCode: vehicle.plateCode,
                  plateNumber: vehicle.plateNumber,
                  vin: vehicle.vin,
                  ownershipType: vehicle.ownershipType,
                  supplierId: vehicle.supplierId ?? "",
                  sourceDate: dateInput(vehicle.sourceDate),
                  purchasePrice:
                    vehicle.purchasePriceFils !== null
                      ? Money.toDecimalString(vehicle.purchasePriceFils)
                      : "",
                  supplierMonthlyCost:
                    vehicle.supplierMonthlyCostFils !== null
                      ? Money.toDecimalString(vehicle.supplierMonthlyCostFils)
                      : "",
                  notes: vehicle.notes ?? "",
                }}
              />
            ) : (
              <p className="muted">{t("detail.readOnly")}</p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>{t("detail.timelineTitle")}</h2>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="data">
              <tbody>
                {vehicle.statusChanges.map((change) => (
                  <tr key={change.id}>
                    <td style={{ whiteSpace: "nowrap" }} className="muted">
                      <time dateTime={change.changedAt.toISOString()}>
                        {format.dateTime(change.changedAt, { dateStyle: "medium", timeStyle: "short" })}
                      </time>
                    </td>
                    <td style={{ fontWeight: 560 }}>
                      {change.fromStatus === null
                        ? t("detail.joined")
                        : t("detail.changed", {
                            from: tStatus(change.fromStatus),
                            to: tStatus(change.toStatus),
                          })}
                    </td>
                    <td className="muted">{change.reason ? <bdi>{change.reason}</bdi> : null}</td>
                    <td className="muted">
                      {change.changedBy ? t("detail.by", { name: change.changedBy.fullName }) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {can("vehicle.delete") ? (
          <div className="card">
            <div className="card-header">
              <h2>{t("detail.dangerTitle")}</h2>
            </div>
            <div className="card-body">
              <p className="muted">{t("detail.dangerHint")}</p>
              <DeleteVehicleForm action={deleteVehicleAction.bind(null, vehicle.id)} />
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
