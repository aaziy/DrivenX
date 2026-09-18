import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { businessDate } from "@drivenx/core";
import { prisma } from "@drivenx/db";

import { requirePermission } from "@/lib/auth";

import { createContractAction } from "../actions";
import { ContractForm } from "./contract-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contracts");
  return { title: `${t("newTitle")} · DrivenX` };
}

export default async function NewContractPage() {
  await requirePermission("contract.create");

  const [t, customers, vehicles] = await Promise.all([
    getTranslations("contracts"),
    // Blacklisted customers are not offered; the service refuses them anyway.
    prisma.customer.findMany({
      where: { deletedAt: null, status: "ACTIVE" },
      orderBy: { fullName: "asc" },
      select: { id: true, code: true, fullName: true },
    }),
    // Cars that can go out: not already on a contract, sold or in the workshop.
    prisma.vehicle.findMany({
      where: { deletedAt: null, status: { in: ["AVAILABLE", "RESERVED", "RETURNED"] } },
      orderBy: [{ make: "asc" }, { model: "asc" }],
      select: { id: true, code: true, make: true, model: true, year: true, plateCode: true, plateNumber: true, ownershipType: true },
    }),
  ]);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            <Link href="/contracts">{t("detail.back")}</Link>
          </p>
          <h1>{t("newTitle")}</h1>
          <p className="page-subtitle">{t("newSubtitle")}</p>
        </div>
      </header>

      <div className="page-body">
        <div className="card">
          <div className="card-body">
            <ContractForm
              action={createContractAction}
              today={businessDate(new Date())}
              customers={customers.map((c) => ({ id: c.id, label: `${c.fullName} (${c.code})` }))}
              vehicles={vehicles.map((v) => ({
                id: v.id,
                label: `${v.make} ${v.model} ${v.year} · ${v.plateCode} ${v.plateNumber} (${v.code})`,
                ownership: v.ownershipType,
              }))}
            />
          </div>
        </div>
      </div>
    </>
  );
}
