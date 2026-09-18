import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { prisma } from "@drivenx/db";

import { requirePermission } from "@/lib/auth";

import { createVehicleAction } from "../actions";
import { VehicleForm } from "../vehicle-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("vehicles");
  return { title: `${t("addTitle")} · DrivenX` };
}

export default async function NewVehiclePage() {
  await requirePermission("vehicle.create");

  const [t, suppliers] = await Promise.all([
    getTranslations("vehicles"),
    // Active suppliers only: a new lease is not taken from one marked inactive.
    prisma.supplier.findMany({
      where: { deletedAt: null, status: "ACTIVE" },
      orderBy: { companyName: "asc" },
      select: { id: true, code: true, companyName: true },
    }),
  ]);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            <Link href="/vehicles">{t("detail.back")}</Link>
          </p>
          <h1>{t("addTitle")}</h1>
        </div>
      </header>

      <div className="page-body">
        <div className="card">
          <div className="card-body">
            <VehicleForm
              action={createVehicleAction}
              mode="create"
              suppliers={suppliers.map((s) => ({ id: s.id, label: `${s.companyName} (${s.code})` }))}
            />
          </div>
        </div>
      </div>
    </>
  );
}
