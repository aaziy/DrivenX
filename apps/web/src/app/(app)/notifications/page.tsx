import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { prisma } from "@drivenx/db";

import { SubmitButton } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { resolveDocumentEntities, visibilityWhere, visibleTypes } from "@/lib/notifications";

import { markAllNotificationsRead, markNotificationRead } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notifications");
  return { title: `${t("title")} · DrivenX` };
}

const PAGE_SIZE = 50;

export default async function NotificationsPage() {
  const principal = await requireUser();
  const types = visibleTypes(principal);

  const [t, format, notifications] = await Promise.all([
    getTranslations("notifications"),
    getFormatter(),
    types.length === 0
      ? []
      : prisma.notification.findMany({
          where: visibilityWhere(principal),
          // Unread first, then most recent: the list is a queue, not a history.
          orderBy: [{ readAt: "asc" }, { createdAt: "desc" }],
          take: PAGE_SIZE,
        }),
  ]);

  const entities = await resolveDocumentEntities(
    notifications.filter((n) => n.entityType === "Document").map((n) => n.entityId),
  );

  const unread = notifications.filter((n) => n.readAt === null).length;

  const tone = (severity: string) =>
    severity === "CRITICAL" ? "badge-danger" : severity === "WARNING" ? "badge-warning" : "";

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("title")}</h1>
          <p className="page-subtitle">{t("subtitle")}</p>
        </div>
      </header>

      <div className="page-body stack">
        <div className="card">
          <div className="card-header">
            <h2>{t("allTitle")}</h2>
            <span className="row" style={{ gap: 12, alignItems: "center" }}>
              <span className="muted">{t("unreadCount", { count: unread })}</span>
              {unread > 0 ? (
                <form action={markAllNotificationsRead}>
                  <SubmitButton variant="secondary" pendingLabel={t("marking")}>
                    {t("markAllRead")}
                  </SubmitButton>
                </form>
              ) : null}
            </span>
          </div>

          {notifications.length === 0 ? (
            <div className="card-body">
              <p className="muted">{t("empty")}</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table>
                <tbody>
                  {notifications.map((notification) => {
                    const entity = entities.get(notification.entityId);
                    const state = notification.severity === "CRITICAL" ? "expired" : "expiring";

                    // The stored English text is the payload for the delivery layer
                    // (P3-01). What is shown is built here, so it reads in the chosen
                    // language. If the record it points at is gone, the stored sentence
                    // is still better than an empty row.
                    const heading =
                      notification.type === "DOCUMENT_EXPIRY"
                        ? t(`types.DOCUMENT_EXPIRY.${state}.title`)
                        : notification.title;

                    const detail =
                      notification.type === "DOCUMENT_EXPIRY" && entity
                        ? t(`types.DOCUMENT_EXPIRY.${state}.body`, {
                            what: entity.what,
                            who: entity.who,
                            date: notification.dueOn
                              ? format.dateTime(notification.dueOn, { dateStyle: "medium" })
                              : "",
                          })
                        : notification.body;

                    return (
                      <tr key={notification.id}>
                        <td style={{ width: 1, whiteSpace: "nowrap" }}>
                          <span className={`badge ${tone(notification.severity)}`.trim()}>
                            {t(`severity.${notification.severity}`)}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: notification.readAt ? 400 : 600 }}>
                            {heading}
                          </div>
                          <div className="muted" style={{ fontSize: 12.5 }}>
                            {detail}
                          </div>
                        </td>
                        <td className="muted" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
                          <time dateTime={notification.createdAt.toISOString()}>
                            {format.dateTime(notification.createdAt, { dateStyle: "medium" })}
                          </time>
                        </td>
                        <td>
                          <span className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                            {entity ? (
                              <Link className="btn-secondary" href={entity.href}>
                                {t("open")}
                              </Link>
                            ) : null}
                            {notification.readAt === null ? (
                              <form action={markNotificationRead.bind(null, notification.id)}>
                                <SubmitButton variant="secondary" pendingLabel={t("marking")}>
                                  {t("markRead")}
                                </SubmitButton>
                              </form>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
