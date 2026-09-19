import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { can } from "@drivenx/auth";

import { requirePermission } from "@/lib/auth";
import { offerableVehicles, salespeople } from "@/lib/leads";

import { createLeadAction } from "../actions";
import { LeadForm } from "../lead-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("leads");
  return { title: `${t("newTitle")} · DrivenX` };
}

export default async function NewLeadPage() {
  const principal = await requirePermission("lead.create");
  const canAssign = can(principal, "lead.view_all");

  const [t, vehicles, people] = await Promise.all([
    getTranslations("leads"),
    offerableVehicles(),
    canAssign ? salespeople() : null,
  ]);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            <Link href="/leads">{t("detail.back")}</Link>
          </p>
          <h1>{t("newTitle")}</h1>
          <p className="page-subtitle">{t("newSubtitle")}</p>
        </div>
      </header>
      <div className="page-body">
        <div className="card">
          <div className="card-body">
            <LeadForm
              action={createLeadAction}
              vehicles={vehicles}
              salespeople={people}
              mode="create"
              // A lead is its author's unless they hand it to someone.
              defaults={{
                name: "",
                mobile: "",
                email: "",
                source: "WALK_IN",
                interestedVehicleId: "",
                budget: "",
                durationMonths: "",
                notes: "",
                salespersonId: principal.id,
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
