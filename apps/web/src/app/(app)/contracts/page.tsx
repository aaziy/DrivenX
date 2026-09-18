import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { CONTRACT_STATUSES, isContractStatus, Money } from "@drivenx/core";
import { prisma } from "@drivenx/db";

import { DataTable, type Column } from "@/components/data-table";
import { requirePermission } from "@/lib/auth";

import { contractStatusTone } from "./tone";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contracts");
  return { title: `${t("title")} · DrivenX` };
}

const PAGE_SIZE = 25;
const TYPES = ["LONG_TERM_RENTAL", "LEASE_TO_OWN", "B2B_RENTAL", "OTHER"] as const;

type ContractRow = {
  id: string;
  number: string;
  type: string;
  status: string;
  startDate: Date;
  endDate: Date;
  monthlyRentalFils: bigint;
  customer: { fullName: string; code: string };
  vehicle: { make: string; model: string; plateCode: string; plateNumber: string };
};

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; type?: string; page?: string }>;
}) {
  const principal = await requirePermission("contract.view");
  const canCreate = principal.permissions.has("contract.create");

  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const status = params.status && isContractStatus(params.status) ? params.status : undefined;
  const type = TYPES.find((value) => value === params.type);
  const page = Math.max(1, Number(params.page) || 1);

  const contains = { contains: query, mode: "insensitive" as const };
  const where = {
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
    ...(query
      ? {
          OR: [
            { number: contains },
            { customer: { fullName: contains } },
            { customer: { code: contains } },
            { vehicle: { plateNumber: { contains: query.replace(/\D/g, "") || query } } },
            { vehicle: { code: contains } },
          ],
        }
      : {}),
  };

  const [t, tStatus, tTypes, format, contracts, total] = await Promise.all([
    getTranslations("contracts"),
    getTranslations("contracts.status"),
    getTranslations("contracts.types"),
    getFormatter(),
    prisma.contract.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        number: true,
        type: true,
        status: true,
        startDate: true,
        endDate: true,
        monthlyRentalFils: true,
        customer: { select: { fullName: true, code: true } },
        vehicle: { select: { make: true, model: true, plateCode: true, plateNumber: true } },
      },
    }),
    prisma.contract.count({ where }),
  ]);

  const day = (date: Date) => format.dateTime(date, { dateStyle: "medium", timeZone: "UTC" });

  const columns: Column<ContractRow>[] = [
    {
      key: "number",
      header: t("columns.number"),
      render: (row) => (
        <Link href={`/contracts/${row.id}`}>
          <bdi>{row.number}</bdi>
        </Link>
      ),
    },
    {
      key: "customer",
      header: t("columns.customer"),
      render: (row) => (
        <>
          <div style={{ fontWeight: 560 }}>{row.customer.fullName}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            <bdi>{row.customer.code}</bdi>
          </div>
        </>
      ),
    },
    {
      key: "vehicle",
      header: t("columns.vehicle"),
      render: (row) => (
        <>
          <bdi>
            {row.vehicle.make} {row.vehicle.model}
          </bdi>
          <div className="muted" style={{ fontSize: 12.5 }}>
            <bdi>
              {row.vehicle.plateCode} {row.vehicle.plateNumber}
            </bdi>
          </div>
        </>
      ),
    },
    { key: "type", header: t("columns.type"), render: (row) => <span className="muted">{tTypes(row.type)}</span> },
    {
      key: "term",
      header: t("columns.term"),
      render: (row) => (
        <span className="muted" style={{ fontSize: 12.5 }}>
          {day(row.startDate)} – {day(row.endDate)}
        </span>
      ),
    },
    {
      key: "monthly",
      header: t("columns.monthly"),
      numeric: true,
      render: (row) => Money.format(row.monthlyRentalFils),
    },
    {
      key: "status",
      header: t("columns.status"),
      render: (row) => (
        <span className={`badge ${contractStatusTone(row.status)}`.trim()}>{tStatus(row.status)}</span>
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
          <Link href="/contracts/new" className="btn-primary">
            {t("new")}
          </Link>
        ) : null}
      </header>

      <div className="page-body">
        <div className="card">
          <div className="card-header">
            <h2>{t("allTitle")}</h2>
            <span className="muted">{format.number(total)}</span>
          </div>
          <div className="card-body">
            <form method="get" className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <div className="field" style={{ flex: "1 1 220px", marginBottom: 0 }}>
                <label htmlFor="q">{t("filters.search")}</label>
                <input id="q" name="q" type="search" defaultValue={query} placeholder={t("filters.searchPlaceholder")} />
              </div>
              <div className="field" style={{ flex: "0 1 170px", marginBottom: 0 }}>
                <label htmlFor="status">{t("filters.status")}</label>
                <select id="status" name="status" defaultValue={status ?? ""}>
                  <option value="">{t("filters.all")}</option>
                  {CONTRACT_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {tStatus(value)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: "0 1 190px", marginBottom: 0 }}>
                <label htmlFor="type">{t("filters.type")}</label>
                <select id="type" name="type" defaultValue={type ?? ""}>
                  <option value="">{t("filters.all")}</option>
                  {TYPES.map((value) => (
                    <option key={value} value={value}>
                      {tTypes(value)}
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
            rows={contracts}
            columns={columns}
            rowKey={(row) => row.id}
            emptyTitle={query || status || type ? t("emptyFiltered") : t("emptyTitle")}
          />
        </div>
      </div>
    </>
  );
}
