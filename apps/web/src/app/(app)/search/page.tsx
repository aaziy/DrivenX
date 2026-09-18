import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { globalSearch, type SearchHit } from "@drivenx/db";

import { requireUser } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("search");
  return { title: `${t("title")} · DrivenX` };
}

/**
 * Where a hit leads.
 *
 * A document is never a destination in its own right — the number was searched for to
 * find the person it belongs to, so the link goes to their record.
 */
function hrefFor(hit: SearchHit): string | null {
  if (hit.kind === "customer") return `/customers/${hit.id}`;
  if (hit.kind === "supplier") return `/suppliers/${hit.id}`;
  if (hit.kind === "vehicle") return `/vehicles/${hit.id}`;

  if (hit.ownerType === "CUSTOMER") return `/customers/${hit.ownerId}`;
  if (hit.ownerType === "SUPPLIER") return `/suppliers/${hit.ownerId}`;
  if (hit.ownerType === "VEHICLE") return `/vehicles/${hit.ownerId}`;
  return null;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const principal = await requireUser();
  const query = ((await searchParams).q ?? "").trim();

  const t = await getTranslations("search");

  // Scoped to what this person may see. Without it, searching a name would reveal
  // suppliers and their bank contacts to someone with no supplier access at all.
  const scope = {
    customers: principal.permissions.has("customer.view"),
    suppliers: principal.permissions.has("supplier.view"),
    vehicles: principal.permissions.has("vehicle.view"),
    documents: principal.permissions.has("document.view"),
  };

  const hits = query.length >= 2 ? await globalSearch(query, scope) : [];

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("title")}</h1>
          <p className="page-subtitle">{t("subtitle")}</p>
        </div>
      </header>

      <div className="page-body stack">
        <div className="card">
          <div className="card-header">
            <h2>{query ? t("resultsFor", { query }) : t("title")}</h2>
            {query ? <span className="muted">{t("resultCount", { count: hits.length })}</span> : null}
          </div>

          {query.length < 2 ? (
            <div className="card-body">
              <p className="muted">{t("prompt")}</p>
            </div>
          ) : hits.length === 0 ? (
            <div className="card-body">
              <p className="muted">{t("empty", { query })}</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data">
                <tbody>
                  {hits.map((hit) => {
                    const href = hrefFor(hit);

                    return (
                      <tr key={`${hit.kind}:${hit.id}`}>
                        <td style={{ width: 1, whiteSpace: "nowrap" }}>
                          <span className="badge">{t(`kinds.${hit.kind}`)}</span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 560 }}>
                            <bdi>{hit.label}</bdi>
                          </div>
                          {hit.sublabel ? (
                            <div className="muted" style={{ fontSize: 12.5 }}>
                              <bdi>{hit.sublabel}</bdi>
                            </div>
                          ) : null}
                        </td>
                        <td style={{ width: 1, whiteSpace: "nowrap" }}>
                          {href ? (
                            <Link className="btn-secondary" href={href}>
                              {t("open")}
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
