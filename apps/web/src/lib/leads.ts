import { can, type Principal } from "@drivenx/auth";
import { leadScope, prisma } from "@drivenx/db";

/**
 * Which leads a person may see (P1F-05): everyone's with lead.view_all, otherwise only
 * the ones assigned to them. Every lead query in the app goes through this, so a
 * salesperson cannot reach a colleague's lead by guessing its address either.
 */
export function leadWhere(principal: Principal) {
  return leadScope({ id: principal.id, seeAll: can(principal, "lead.view_all") });
}

/** One lead, if it is in the reader's scope; null otherwise, as if it did not exist. */
export function findScopedLead(principal: Principal, leadId: string): Promise<{ id: string } | null> {
  return prisma.lead.findFirst({ where: { ...leadWhere(principal), id: leadId }, select: { id: true } });
}

/** Active users who can own leads — the choices when assigning one. */
export function salespeople(): Promise<Array<{ id: string; fullName: string }>> {
  return prisma.user.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      roles: { some: { role: { permissions: { some: { permission: { key: "lead.create" } } } } } },
    },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true },
  });
}

/** Cars that can be offered: not on a contract, sold or in the workshop. */
export async function offerableVehicles(): Promise<
  Array<{ id: string; label: string; ownership: "COMPANY_OWNED" | "B2B_SUPPLIER" }>
> {
  const vehicles = await prisma.vehicle.findMany({
    where: { deletedAt: null, status: { in: ["AVAILABLE", "RESERVED", "RETURNED"] } },
    orderBy: [{ make: "asc" }, { model: "asc" }],
    select: { id: true, code: true, make: true, model: true, year: true, plateCode: true, plateNumber: true, ownershipType: true },
  });
  return vehicles.map((v) => ({
    id: v.id,
    label: `${v.make} ${v.model} ${v.year} · ${v.plateCode} ${v.plateNumber} (${v.code})`,
    ownership: v.ownershipType,
  }));
}
