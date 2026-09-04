import type { ReactNode } from "react";

/**
 * Inline result messaging.
 *
 * Server-rendered rather than a floating toast: a server action's outcome arrives
 * with the re-rendered page, and an assertive live region announces it to screen
 * readers without a client-side store to keep in sync.
 */
export function Alert({
  tone,
  children,
}: {
  tone: "error" | "success";
  children: ReactNode;
}) {
  return (
    <div className={`alert alert-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}
