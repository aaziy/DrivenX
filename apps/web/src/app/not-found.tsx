import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const [t, tc] = await Promise.all([getTranslations("notFound"), getTranslations("common")]);

  return (
    <main className="login-page">
      <div className="login-card">
        <div className="card">
          <div className="card-body">
            <h1>{t("title")}</h1>
            <p className="muted">{t("body")}</p>
            <Link href="/" className="btn-link">
              {tc("backToDashboardLink")}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
