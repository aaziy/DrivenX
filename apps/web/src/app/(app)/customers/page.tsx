import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { parsePartyCode } from "@drivenx/core";
import { prisma } from "@drivenx/db";

import { DataTable, type Column } from "@/components/data-table";
import { requirePermission } from "@/lib/auth";

import { CreateCustomerCard } from "./create-customer-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("customers");
  return { title: `${t("title")} · DrivenX` };
}

const PAGE_SIZE = 25;
const STATUSES = ["ACTIVE", "INACTIVE", "BLACKLISTED"] as const;
type PartyStatus = (typeof STATUSES)[number];

type CustomerRow = {
  id: string;
  code: string;
  fullName: string;
  mobile: string;
  email: string | null;
  status: PartyStatus;
  createdAt: Date;
};

/**
 * Search across the three things staff actually have to hand: the code they were read
 * over the phone, a name, or a number. §16's fuzzy global search lands in P1A-09 with a
 * trigram index; this is the exact-ish version that the list page needs today.
 */
function searchFilter(query: string) {
  const code = parsePartyCode(query);
  if (code?.kind === "customer") {
    return [{ code: { equals: `CUS-${String(code.sequence).padStart(5, "0")}` } }];
  }

  const digits = query.replace(/\D/g, "");

  return [
    { fullName: { contains: query, mode: "insensitive" as const } },
    { code: { contains: query, mode: "insensitive" as const } },
    { email: { contains: query, mode: "insensitive" as const } },
    // The last nine digits are the number itself, whatever prefix was typed with it.
    ...(digits.length >= 3 ? [{ mobile: { contains: digits.slice(-9) } }] : []),
  ];
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const principal = await requirePermission("customer.view");
  const canCreate = principal.permissions.has("customer.create");

  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const status = STATUSES.find((candidate) => candidate === params.status);
  const page = Math.max(1, Number(params.page) || 1);

  const where = {
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(query ? { OR: searchFilter(query) } : {}),
  };

  const [t, tc, format, customers, total] = await Promise.all([
    getTranslations("customers"),
    getTranslations("common"),
    getFormatter(),
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        code: true,
        fullName: true,
        mobile: true,
        email: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.customer.count({ where }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const statusLabel = (value: PartyStatus) =>
    ({
      ACTIVE: t("status.active"),
      INACTIVE: t("status.inactive"),
      BLACKLISTED: t("status.blacklisted"),
    })[value];

  // An inactive customer gets the plain badge; the empty string keeps the class list
  // from reading "badge badge".
  const statusTone = (value: PartyStatus) =>
    ({ ACTIVE: "badge-success", INACTIVE: "", BLACKLISTED: "badge-danger" })[value];

  const columns: Column<CustomerRow>[] = [
    {
      key: "code",
      header: t("columns.code"),
      render: (customer) => (
        <Link href={`/customers/${customer.id}`}>
          <bdi>{customer.code}</bdi>
        </Link>
      ),
    },
    {
      key: "name",
      header: t("columns.name"),
      render: (customer) => (
        <>
          <div style={{ fontWeight: 560 }}>{customer.fullName}</div>
          {customer.email ? (
            <div className="muted" style={{ fontSize: 12.5 }}>
              <bdi>{customer.email}</bdi>
            </div>
          ) : null}
        </>
      ),
    },
    {
      key: "mobile",
      header: t("columns.mobile"),
      render: (customer) => <bdi>{customer.mobile}</bdi>,
    },
    {
      key: "status",
      header: t("columns.status"),
      render: (customer) => (
        <span className={`badge ${statusTone(customer.status)}`.trim()}>
          {statusLabel(customer.status)}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: t("columns.added"),
      render: (customer) => (
        <time dateTime={customer.createdAt.toISOString()}>
          {format.dateTime(customer.createdAt, { dateStyle: "medium" })}
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
        {canCreate ? <CreateCustomerCard /> : null}

        <div className="card">
          <div className="card-header">
            <h2>{t("allTitle")}</h2>
            <span className="muted">{tc("total", { count: total })}</span>
          </div>

          <div className="card-body">
            {/* A plain GET form: the results stay linkable and it works without JavaScript. */}
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
            rows={customers}
            columns={columns}
            rowKey={(customer) => customer.id}
            emptyTitle={query || status ? t("emptyFiltered") : t("emptyTitle")}
          />

          {pageCount > 1 ? (
            <div className="card-body row" style={{ justifyContent: "space-between" }}>
              <span className="muted">{t("pageOf", { page, pageCount })}</span>
              <span className="row" style={{ gap: 8 }}>
                {page > 1 ? (
                  <Link
                    className="btn-secondary"
                    href={{ pathname: "/customers", query: { ...params, page: page - 1 } }}
                  >
                    {t("previous")}
                  </Link>
                ) : null}
                {page < pageCount ? (
                  <Link
                    className="btn-secondary"
                    href={{ pathname: "/customers", query: { ...params, page: page + 1 } }}
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
