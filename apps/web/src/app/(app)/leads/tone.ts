/** Badge colours for the pipeline: amber while it needs work, green once it is won. */
export function leadStatusTone(status: string): string {
  switch (status) {
    case "DEAL_CREATED":
      return "badge-warning";
    case "CONTRACTED":
      return "badge-success";
    case "LOST":
      return "badge-danger";
    default:
      return "";
  }
}
