import { getFormatter, getTranslations } from "next-intl/server";

import { Money } from "@drivenx/core";
import { vehicleLifetime } from "@drivenx/db";

import { CategoryBreakdown } from "@/components/category-breakdown";

/**
 * What one car has earned and cost, for as long as DrivenX has had it (P2-14).
 *
 * Over a life rather than a period, because the question it answers — was this car worth
 * owning — is not one a month can settle: a car can lose money through every month of a
 * repair and still have paid for itself twice over.
 *
 * It reads the same ledger as the profitability report, so the two cannot disagree.
 */
export async function LifetimeCard({ vehicleId }: { vehicleId: string }) {
  const [t, format, life] = await Promise.all([
    getTranslations("reports"),
    getFormatter(),
    vehicleLifetime(vehicleId),
  ]);

  const day = (date: Date) => format.dateTime(date, { dateStyle: "medium", timeZone: "UTC" });

  return (
    <section className="card">
      <div className="card-header">
        <h2>{t("lifetimeTitle")}</h2>
        {life.firstEntryOn && life.lastEntryOn ? (
          <span className="muted">
            {t("lifetimeSince", { from: day(life.firstEntryOn), to: day(life.lastEntryOn) })}
          </span>
        ) : null}
      </div>

      <div className="card-body">
        {life.byCategory.length === 0 ? (
          <p className="muted">{t("lifetimeNothing")}</p>
        ) : (
          <>
            {/* Divs, not spans: the tile's label sits above its value, as on the
                dashboard, and inline elements ran the two together. */}
            <div className="stat-grid">
              <div className="stat">
                <div className="stat-label">{t("columns.revenue")}</div>
                <div className="stat-value">{Money.format(life.revenueFils, { currency: null })}</div>
              </div>
              <div className="stat">
                <div className="stat-label">{t("columns.cost")}</div>
                <div className="stat-value">{Money.format(life.costFils, { currency: null })}</div>
              </div>
              <div className="stat">
                <div className="stat-label">{t("columns.profit")}</div>
                {/* A loss is shown as a loss. A car that has cost more than it earned is
                    a fact the fleet needs, not one to round away at zero. */}
                <div className={`stat-value${life.profitFils < 0n ? " negative" : ""}`}>
                  {Money.format(life.profitFils, { currency: null })}
                </div>
              </div>
            </div>
            <p className="field-hint">{t("lifetimeHint")}</p>
            <CategoryBreakdown totals={life.byCategory} />
          </>
        )}
      </div>
    </section>
  );
}
