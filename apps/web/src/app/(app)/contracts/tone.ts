/** Badge colours: green is healthy, amber needs attention, red is money late. */
export function contractStatusTone(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "badge-success";
    case "PENDING":
      return "badge-warning";
    case "OVERDUE":
      return "badge-danger";
    default:
      return "";
  }
}

export function installmentStatusTone(status: string): string {
  switch (status) {
    case "PAID":
      return "badge-success";
    case "DUE":
    case "PARTIALLY_PAID":
      return "badge-warning";
    case "OVERDUE":
      return "badge-danger";
    default:
      return "";
  }
}
