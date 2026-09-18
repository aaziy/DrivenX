import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { isVehicleStatus, VEHICLE_STATUSES, type VehicleStatus } from "@drivenx/core";
import { prisma } from "@drivenx/db";

import { DataTable, type Column } from "@/components/data-table";
import { requirePermission } from "@/lib/auth";

import { vehicleStatusTone } from "./tone";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("vehicles");
  return { title: `${t("title")} · DrivenX` };
}

const PAGE_SIZE = 25;
const OWNERSHIP = ["COMPANY_OWNED", "B2B_SUPPLIER"] as const;

type VehicleRow = {
  id: string;
  code: string;
  make: string;
  model: string;
  year: number;
  variant: string | null;
  plateEmirate: string;
  plateCode: string;
  plateNumber: string;
  ownershipType: (typeof OWNERSHIP)[number];
  currentMileageKm: number;
  status: VehicleStatus;
};

function searchFilter(query: string) {
  const contains = { contains: query, mode: "insensitive" as const };
  return [
    { code: contains },
    { plateNumber: { contains: query.replace(/\D/g, "") || query } },
    { vin: contains },
    { make: contains },
    { model: contains },
  ];
}

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; ownership?: string; page?: string }>;
}) {
  const principal = await requirePermission("vehicle.view");
  const canCreate = principal.permissions.has("vehicle.create");

  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const status = params.status && isVehicleStatus(params.status) ? params.status : undefined;
  const ownership = OWNERSHIP.find((value) => value === params.ownership);
  const page = Math.max(1, Number(params.page) || 1);

  const where = {
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(ownership ? { ownershipType: ownership } : {}),
    ...(query ? { OR: searchFilter(query) } : {}),
  };

  const [t, tStatus, tOwnership, tEmirates, format, vehicles, total] = await Promise.all([
    getTranslations("vehicles"),
    getTranslations("vehicles.status"),
    getTranslations("vehicles.ownership"),
    getTranslations("vehicles.emirates"),
    getFormatter(),
    prisma.vehicle.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        code: true,
        make: true,
        model: true,
        year: true,
        variant: true,
        plateEmirate: true,
        plateCode: true,
        plateNumber: true,
        ownershipType: true,
        currentMileageKm: true,
        status: true,
      },
    }),
    prisma.vehicle.count({ where }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: Column<VehicleRow>[] = [
    {
      key: "code",
      header: t("columns.code"),
      render: (vehicle) => (
        <Link href={`/vehicles/${vehicle.id}`}>
          <bdi>{vehicle.code}</bdi>
        </Link>
      ),
    },
    {
      key: "vehicle",
      header: t("columns.vehicle"),
      render: (vehicle) => (
        <>
          <div style={{ fontWeight: 560 }}>
            <bdi>
              {vehicle.make} {vehicle.model}
            </bdi>{" "}
            <span className="muted">{vehicle.year}</span>
          </div>
          {vehicle.variant ? (
            <div className="muted" style={{ fontSize: 12.5 }}>
              <bdi>{vehicle.variant}</bdi>
            </div>
          ) : null}
        </>
      ),
    },
    {
      key: "plate",
      header: t("columns.plate"),
      render: (vehicle) => (
        <>
          <bdi style={{ fontWeight: 560 }}>
            {vehicle.plateCode} {vehicle.plateNumber}
          </bdi>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {tEmirates(vehicle.plateEmirate)}
          </div>
        </>
      ),
    },
    {
      key: "ownership",
      header: t("columns.ownership"),
      render: (vehicle) => <span className="muted">{tOwnership(vehicle.ownershipType)}</span>,
    },
    {
      key: "mileage",
      header: t("columns.mileage"),
      numeric: true,
      render: (vehicle) => t("km", { km: vehicle.currentMileageKm }),
    },
    {
      key: "status",
      header: t("columns.status"),
      render: (vehicle) => (
        <span className={`badge ${vehicleStatusTone(vehicle.status)}`.trim()}>
          {tStatus(vehicle.status)}
        </span>
      ),
    },
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("title")}</h1>
          <p className="page-subtitle">{t("subtitle")}</p>
        </div>
        {canCreate ? (
          <Link href="/vehicles/new" className="btn-primary">
            {t("add")}
          </Link>
        ) : null}
      </header>

      <div className="page-body stack">
        <div className="card">
          <div className="card-header">
            <h2>{t("allTitle")}</h2>
            <span className="muted">{format.number(total)}</span>
          </div>

          <div className="card-body">
            <form method="get" className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <div className="field" style={{ flex: "1 1 220px", marginBottom: 0 }}>
                <label htmlFor="q">{t("filters.search")}</label>
                <input
                  id="q"
                  name="q"
                  type="search"
                  defaultValue={query}
                  placeholder={t("filters.searchPlaceholder")}
                />
              </div>

              <div className="field" style={{ flex: "0 1 170px", marginBottom: 0 }}>
                <label htmlFor="status">{t("filters.status")}</label>
                <select id="status" name="status" defaultValue={status ?? ""}>
                  <option value="">{t("filters.all")}</option>
                  {VEHICLE_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {tStatus(value)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field" style={{ flex: "0 1 190px", marginBottom: 0 }}>
                <label htmlFor="ownership">{t("filters.ownership")}</label>
                <select id="ownership" name="ownership" defaultValue={ownership ?? ""}>
                  <option value="">{t("filters.all")}</option>
                  {OWNERSHIP.map((value) => (
                    <option key={value} value={value}>
                      {tOwnership(value)}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ alignSelf: "end" }}>
                <button type="submit" className="btn-secondary">
                  {t("filters.apply")}
                </button>
              </div>
            </form>
          </div>

          <DataTable
            rows={vehicles}
            columns={columns}
            rowKey={(vehicle) => vehicle.id}
            emptyTitle={query || status || ownership ? t("emptyFiltered") : t("emptyTitle")}
          />

          {pageCount > 1 ? (
            <div className="card-body row" style={{ justifyContent: "space-between" }}>
              <span className="muted">{t("pageOf", { page, pageCount })}</span>
              <span className="row" style={{ gap: 8 }}>
                {page > 1 ? (
                  <Link
                    className="btn-secondary"
                    href={{ pathname: "/vehicles", query: { ...params, page: page - 1 } }}
                  >
                    {t("previous")}
                  </Link>
                ) : null}
                {page < pageCount ? (
                  <Link
                    className="btn-secondary"
                    href={{ pathname: "/vehicles", query: { ...params, page: page + 1 } }}
                  >
                    {t("next")}
                  </Link>
                ) : null}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
