import Link from "next/link";

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
export default function Forbidden() {
  return (
    <main className="login-page">
      <div className="login-card">
        <div className="card">
          <div className="card-body">
            <h1>Not permitted</h1>
            <p className="muted">
              Your account does not have access to this page. If you believe it should, ask a
              Super Admin to review your role.
            </p>

            <div className="row" style={{ marginTop: 18, justifyContent: "space-between" }}>
              <Link href="/" className="btn-link">
                ← Back to dashboard
              </Link>
              <form action={logout}>
                <button type="submit" className="btn-secondary">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
