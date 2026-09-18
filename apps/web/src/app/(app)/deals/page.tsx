import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Money } from "@drivenx/core";
import { prisma } from "@drivenx/db";

import { requirePermission } from "@/lib/auth";

import { DealCalculator } from "./deal-calculator";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("deals");
  return { title: `${t("title")} · DrivenX` };
}

export default async function DealsPage() {
  await requirePermission("deal.calculate");

  const [t, vehicles] = await Promise.all([
    getTranslations("deals"),
    // Cars that could be offered: not sold, not already committed to a customer.
    prisma.vehicle.findMany({
      where: { deletedAt: null, status: { in: ["AVAILABLE", "RETURNED", "INACTIVE"] } },
      orderBy: [{ make: "asc" }, { model: "asc" }],
      select: {
        id: true,
        code: true,
        make: true,
        model: true,
        year: true,
        plateCode: true,
        plateNumber: true,
        ownershipType: true,
        purchasePriceFils: true,
        supplierMonthlyCostFils: true,
      },
    }),
  ]);

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("title")}</h1>
          <p className="page-subtitle">{t("subtitle")}</p>
        </div>
      </header>

      <div className="page-body">
        <DealCalculator
          vehicles={vehicles.map((v) => ({
            id: v.id,
            label: `${v.make} ${v.model} ${v.year} · ${v.plateCode} ${v.plateNumber} (${v.code})`,
            ownership: v.ownershipType,
            monthlyCost:
              v.supplierMonthlyCostFils !== null ? Money.toDecimalString(v.supplierMonthlyCostFils) : "",
            purchasePrice:
              v.purchasePriceFils !== null ? Money.toDecimalString(v.purchasePriceFils) : "",
          }))}
        />
      </div>
    </>
  );
}
