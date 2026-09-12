"use client";

import Link from "next/link";

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
  return (
    <div className="page-body">
      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card-body">
          <h1>Something went wrong</h1>
          <p className="muted">
            This page could not be loaded. Nothing you were working on has been saved.
          </p>

          {error.digest ? (
            <p className="muted" style={{ fontSize: 13 }}>
              Reference: <span className="mono">{error.digest}</span>
            </p>
          ) : null}

          <div className="row" style={{ marginTop: 16 }}>
            <button type="button" className="btn-primary" onClick={reset}>
              Try again
            </button>
            <Link href="/" className="btn-link">
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
