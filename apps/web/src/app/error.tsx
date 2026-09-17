"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * Route-level error boundary.
 *
 * Shows the digest Next generated for the failure, which `onRequestError` has already
 * written to the structured log against the same value. The user gets something to
 * quote; support gets an exact key to grep. The error message itself is never
 * rendered — it routinely contains schema and file paths.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("error");
  const tc = useTranslations("common");

  return (
    <div className="page-body">
      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card-body">
          <h1>{t("title")}</h1>
          <p className="muted">{t("body")}</p>

          {error.digest ? (
            <p className="muted" style={{ fontSize: 13 }}>
              {t("reference")}{" "}
              <span className="mono" dir="ltr">
                {error.digest}
              </span>
            </p>
          ) : null}

          <div className="row" style={{ marginTop: 16 }}>
            <button type="button" className="btn-primary" onClick={reset}>
              {t("retry")}
            </button>
            <Link href="/" className="btn-link">
              {tc("backToDashboard")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
