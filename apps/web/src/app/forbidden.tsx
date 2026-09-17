import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { logout } from "./(app)/actions";

/**
 * Rendered when a signed-in user lacks a permission (403).
 *
 * Distinct from the login redirect on purpose: telling someone to sign in again when
 * they are already signed in sends them round a loop they cannot escape.
 *
 * The sign-out button is not decoration. This page renders outside the application
 * shell, so it carries no navigation — and a user whose roles grant nothing (or who
 * followed a link to a page they cannot open) would otherwise have no way out of it
 * at all. "Back to dashboard" fails for exactly the people most likely to land here.
 */
export default async function Forbidden() {
  const [t, tc] = await Promise.all([getTranslations("forbidden"), getTranslations("common")]);

  return (
    <main className="login-page">
      <div className="login-card">
        <div className="card">
          <div className="card-body">
            <h1>{t("title")}</h1>
            <p className="muted">{t("body")}</p>

            <div className="row" style={{ marginTop: 18, justifyContent: "space-between" }}>
              <Link href="/" className="btn-link">
                {tc("backToDashboardLink")}
              </Link>
              <form action={logout}>
                <button type="submit" className="btn-secondary">
                  {tc("signOut")}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
