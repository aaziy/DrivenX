import Link from "next/link";

/**
 * Rendered when a signed-in user lacks a permission (403).
 *
 * Distinct from the login redirect on purpose: telling someone to sign in again when
 * they are already signed in sends them round a loop they cannot escape.
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
            <Link href="/" className="btn-link">
              ← Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
