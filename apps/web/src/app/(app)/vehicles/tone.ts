import type { VehicleStatus } from "@drivenx/core";

/**
 * Badge colour per status. Green is "can be let today"; amber is "out of action for a
 * while"; red is "something has gone wrong". The statuses on contract stay neutral — they
 * are the fleet doing its job.
 */
export function vehicleStatusTone(status: VehicleStatus): string {
  switch (status) {
    case "AVAILABLE":
      return "badge-success";
    case "MAINTENANCE":
    case "RETURNED":
      return "badge-warning";
    case "ACCIDENT":
      return "badge-danger";
    default:
      return "";
  }
}
