import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { parsePartyCode } from "@drivenx/core";
import { prisma } from "@drivenx/db";

import { DataTable, type Column } from "@/components/data-table";
import { requirePermission } from "@/lib/auth";

import { CreateSupplierCard } from "./create-supplier-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("suppliers");
  return { title: `${t("title")} · DrivenX` };
}

const PAGE_SIZE = 25;
const STATUSES = ["ACTIVE", "INACTIVE", "BLACKLISTED"] as const;
type PartyStatus = (typeof STATUSES)[number];

type SupplierRow = {
  id: string;
  code: string;
  companyName: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  status: PartyStatus;
  createdAt: Date;
};

function searchFilter(query: string) {
  const code = parsePartyCode(query);
  if (code?.kind === "supplier") {
    return [{ code: { equals: `SUP-${String(code.sequence).padStart(5, "0")}` } }];
  }

  const digits = query.replace(/\D/g, "");

  return [
    { companyName: { contains: query, mode: "insensitive" as const } },
    { code: { contains: query, mode: "insensitive" as const } },
    { contactPerson: { contains: query, mode: "insensitive" as const } },
    { email: { contains: query, mode: "insensitive" as const } },
    { trn: { contains: query } },
    ...(digits.length >= 3 ? [{ phone: { contains: digits.slice(-7) } }] : []),
  ];
}

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const principal = await requirePermission("supplier.view");
  const canCreate = principal.permissions.has("supplier.create");

  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const status = STATUSES.find((candidate) => candidate === params.status);
  const page = Math.max(1, Number(params.page) || 1);

  const where = {
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(query ? { OR: searchFilter(query) } : {}),
  };

  const [t, tc, format, suppliers, total] = await Promise.all([
    getTranslations("suppliers"),
    getTranslations("common"),
    getFormatter(),
    prisma.supplier.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        code: true,
        companyName: true,
        contactPerson: true,
        phone: true,
        email: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.supplier.count({ where }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const statusLabel = (value: PartyStatus) =>
    ({
      ACTIVE: t("status.active"),
      INACTIVE: t("status.inactive"),
      BLACKLISTED: t("status.blacklisted"),
    })[value];

  const statusTone = (value: PartyStatus) =>
    ({ ACTIVE: "badge-success", INACTIVE: "", BLACKLISTED: "badge-danger" })[value];

  const columns: Column<SupplierRow>[] = [
    {
      key: "code",
      header: t("columns.code"),
      render: (supplier) => (
        <Link href={`/suppliers/${supplier.id}`}>
          <bdi>{supplier.code}</bdi>
        </Link>
      ),
    },
    {
      key: "company",
      header: t("columns.company"),
      render: (supplier) => (
        <>
          <div style={{ fontWeight: 560 }}>{supplier.companyName}</div>
          {supplier.contactPerson ? (
            <div className="muted" style={{ fontSize: 12.5 }}>
              {supplier.contactPerson}
            </div>
          ) : null}
        </>
      ),
    },
    {
      key: "contact",
      header: t("columns.contact"),
      render: (supplier) => (
        <>
          {supplier.phone ? (
            <div>
              <bdi>{supplier.phone}</bdi>
            </div>
          ) : null}
          {supplier.email ? (
            <div className="muted" style={{ fontSize: 12.5 }}>
              <bdi>{supplier.email}</bdi>
            </div>
          ) : null}
          {!supplier.phone && !supplier.email ? <span className="muted">{tc("none")}</span> : null}
        </>
      ),
    },
    {
      key: "status",
      header: t("columns.status"),
      render: (supplier) => (
        <span className={`badge ${statusTone(supplier.status)}`.trim()}>
          {statusLabel(supplier.status)}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: t("columns.added"),
      render: (supplier) => (
        <time dateTime={supplier.createdAt.toISOString()}>
          {format.dateTime(supplier.createdAt, { dateStyle: "medium" })}
        </time>
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
      </header>

      <div className="page-body stack">
        {canCreate ? <CreateSupplierCard /> : null}

        <div className="card">
          <div className="card-header">
            <h2>{t("allTitle")}</h2>
            <span className="muted">{tc("total", { count: total })}</span>
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

              <div className="field" style={{ flex: "0 1 180px", marginBottom: 0 }}>
                <label htmlFor="status">{t("filters.status")}</label>
                <select id="status" name="status" defaultValue={status ?? ""}>
                  <option value="">{t("filters.allStatuses")}</option>
                  {STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {statusLabel(value)}
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
            rows={suppliers}
            columns={columns}
            rowKey={(supplier) => supplier.id}
            emptyTitle={query || status ? t("emptyFiltered") : t("emptyTitle")}
          />

          {pageCount > 1 ? (
            <div className="card-body row" style={{ justifyContent: "space-between" }}>
              <span className="muted">{t("pageOf", { page, pageCount })}</span>
              <span className="row" style={{ gap: 8 }}>
                {page > 1 ? (
                  <Link
                    className="btn-secondary"
                    href={{ pathname: "/suppliers", query: { ...params, page: page - 1 } }}
                  >
                    {t("previous")}
                  </Link>
                ) : null}
                {page < pageCount ? (
                  <Link
                    className="btn-secondary"
                    href={{ pathname: "/suppliers", query: { ...params, page: page + 1 } }}
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
