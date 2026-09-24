import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { businessDate, Money } from "@drivenx/core";
import { expenseTotals, listExpenses, prisma } from "@drivenx/db";

import { requirePermission } from "@/lib/auth";

import { recordExpenseAction } from "./actions";
import { ExpenseForm } from "./expense-form";

export const metadata: Metadata = { title: "Expenses · DrivenX" };

/**
 * Everything DrivenX pays for that is not a supplier's monthly bill, a service, a fine
 * or a crash (P2-11, SOW §13).
 *
 * The breakdown leads, because the question this screen answers is "where is the money
 * going" rather than "what did we buy on Tuesday". Both are here; the totals are first.
 */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const principal = await requirePermission("expense.view");
  const can = (key: Parameters<typeof principal.permissions.has>[0]) => principal.permissions.has(key);

  const [t, format] = await Promise.all([getTranslations("expenses"), getFormatter()]);
  const today = businessDate(new Date());

  // This month by default: an expenses screen showing everything ever is a screen nobody
  // can read, and the period people work in is the one they are closing.
  const params = await searchParams;
  const from = params.from ?? `${today.slice(0, 7)}-01`;
  const to = params.to ?? today;

  const [expenses, totals, vehicles, contracts] = await Promise.all([
    listExpenses({ from, to }),
    expenseTotals({ from, to }),
    can("expense.manage")
      ? prisma.vehicle.findMany({
          where: { deletedAt: null, status: { notIn: ["SOLD", "INACTIVE"] } },
          orderBy: { code: "asc" },
          select: { id: true, code: true, make: true, model: true, plateCode: true, plateNumber: true },
        })
      : Promise.resolve([]),
    can("expense.manage")
      ? prisma.contract.findMany({
          where: { deletedAt: null, status: { in: ["ACTIVE", "OVERDUE"] } },
          orderBy: { number: "asc" },
          select: { id: true, number: true, customer: { select: { fullName: true } } },
        })
      : Promise.resolve([]),
  ]);

  const day = (date: Date) => format.dateTime(date, { dateStyle: "medium", timeZone: "UTC" });
  const amount = (fils: bigint) => Money.format(fils, { currency: null });
  const total = totals.reduce((sum, row) => sum + row.netFils, 0n);

  return (
    <>
      <div className="page-header">
        <h1>{t("title")}</h1>
        <p className="page-subtitle">{t("subtitle")}</p>
      </div>

      <div className="page-body">
        <section className="card">
          <div className="card-header">
            <h2>{t("breakdown")}</h2>
            <span className="muted">
              {day(new Date(`${from}T00:00:00Z`))} – {day(new Date(`${to}T00:00:00Z`))}
            </span>
          </div>
          <div className="card-body">
            {/* A plain GET form: the period is in the URL, so a filtered view can be sent
                to somebody and opens as what they were told to look at. */}
            <form method="get" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="from">{t("from")}</label>
                <input id="from" name="from" type="date" dir="ltr" defaultValue={from} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="to">{t("to")}</label>
                <input id="to" name="to" type="date" dir="ltr" defaultValue={to} />
              </div>
              <button type="submit" className="btn-secondary">
                {t("apply")}
              </button>
            </form>

            {totals.length === 0 ? (
              <p className="muted" style={{ marginTop: 12 }}>
                {t("none")}
              </p>
            ) : (
              <table className="deal-table" style={{ marginTop: 12 }}>
                <tbody>
                  {totals.map((row) => (
                    <tr key={row.category}>
                      <td>{t(`categories.${row.category}`)}</td>
                      <td className="numeric">{amount(row.netFils)}</td>
                    </tr>
                  ))}
                  <tr className="deal-total">
                    <td>{t("total")}</td>
                    <td className="numeric">{amount(total)}</td>
                  </tr>
                </tbody>
              </table>
            )}
            <p className="field-hint">{t("netHint")}</p>
          </div>
        </section>

        {expenses.length > 0 ? (
          <section className="card">
            <div className="card-header">
              <h2>{t("listTitle")}</h2>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>{t("columns.date")}</th>
                    <th>{t("columns.description")}</th>
                    <th>{t("columns.category")}</th>
                    <th>{t("columns.chargedTo")}</th>
                    <th className="numeric">{t("columns.net")}</th>
                    <th className="numeric">{t("columns.vat")}</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((row) => (
                    <tr key={row.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{day(row.incurredOn)}</td>
                      <td>
                        {row.description}
                        {row.supplierName ? <span className="muted"> · {row.supplierName}</span> : null}
                      </td>
                      <td>{t(`categories.${row.category}`)}</td>
                      <td>
                        {row.contract ? (
                          <Link href={`/contracts/${row.contract.id}`}>{row.contract.number}</Link>
                        ) : row.vehicle ? (
                          <Link href={`/vehicles/${row.vehicle.id}`}>
                            {row.vehicle.plateCode} {row.vehicle.plateNumber}
                          </Link>
                        ) : (
                          <span className="muted">{t("allocations.COMPANY")}</span>
                        )}
                      </td>
                      <td className="numeric">{amount(row.netFils)}</td>
                      <td className="numeric muted">{amount(row.vatFils)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {can("expense.manage") ? (
          <section className="card">
            <div className="card-header">
              <h2>{t("addTitle")}</h2>
            </div>
            <div className="card-body">
              <ExpenseForm
                action={recordExpenseAction}
                today={today}
                vehicles={vehicles.map((vehicle) => ({
                  id: vehicle.id,
                  label: `${vehicle.code} · ${vehicle.make} ${vehicle.model} · ${vehicle.plateCode} ${vehicle.plateNumber}`,
                }))}
                contracts={contracts.map((contract) => ({
                  id: contract.id,
                  label: `${contract.number} · ${contract.customer.fullName}`,
                }))}
              />
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
