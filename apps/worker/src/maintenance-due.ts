/**
 * The nightly service check (P2-06, SOW §12).
 *
 * Its own job rather than part of the expiry scan: expiry is about paperwork running out
 * on a date, and a service falls due on a date *or* a distance, which means it can become
 * due because somebody drove the car rather than because a day passed.
 *
 * One alert per car per state — due, then overdue — so a car that is a month late is
 * mentioned twice in all, not thirty times.
 */

import { businessDate, maintenanceDueDedupeKey } from "@drivenx/core";
import { prisma, vehiclesDueForService } from "@drivenx/db";
import { logger } from "@drivenx/logger";

export interface MaintenanceDueResult {
  vehiclesDue: number;
  overdue: number;
  notificationsCreated: number;
}

export async function runMaintenanceDue(now: Date = new Date()): Promise<MaintenanceDueResult> {
  const today = businessDate(now);
  const due = await vehiclesDueForService(today);

  const notifications = due.map(({ vehicle, record, due: state }) => {
    const car = `${vehicle.make} ${vehicle.model}, plate ${vehicle.plateCode} ${vehicle.plateNumber} (${vehicle.code})`;
    // Whichever marker is closer is the one worth quoting: a date nobody can act on is
    // noise when the car is 200 km from its service.
    const byMileage =
      state.kmRemaining !== null && (state.daysRemaining === null || state.kmRemaining <= state.daysRemaining * 100);
    const detail = byMileage
      ? state.overdue
        ? `${Math.abs(state.kmRemaining ?? 0)} km past its service at ${record.nextServiceKm} km.`
        : `${state.kmRemaining} km to its service at ${record.nextServiceKm} km.`
      : state.overdue
        ? `Its service was due on ${record.nextServiceOn ? businessDate(record.nextServiceOn) : ""}.`
        : `Its service is due on ${record.nextServiceOn ? businessDate(record.nextServiceOn) : ""}.`;

    return {
      type: "MAINTENANCE_DUE" as const,
      severity: state.overdue ? ("CRITICAL" as const) : ("WARNING" as const),
      title: state.overdue ? "Service overdue" : "Service due soon",
      body: `${car}. ${detail}`,
      entityType: "Vehicle",
      entityId: vehicle.id,
      dueOn: record.nextServiceOn,
      dedupeKey: maintenanceDueDedupeKey(record.id, state.overdue ? "overdue" : "due"),
    };
  });

  const created = notifications.length
    ? await prisma.notification.createMany({ data: notifications, skipDuplicates: true })
    : { count: 0 };

  return {
    vehiclesDue: due.length,
    overdue: due.filter((row) => row.due.overdue).length,
    notificationsCreated: created.count,
  };
}

export async function runMaintenanceDueLogged(now: Date = new Date()): Promise<MaintenanceDueResult> {
  const startedAt = Date.now();
  const result = await runMaintenanceDue(now);
  logger.info("maintenance due check complete", { ...result, durationMs: Date.now() - startedAt });
  return result;
}
