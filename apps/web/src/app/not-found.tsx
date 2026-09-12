import Link from "next/link";

export default function NotFound() {
  return (
    <main className="login-page">
      <div className="login-card">
        <div className="card">
          <div className="card-body">
            <h1>Page not found</h1>
            <p className="muted">
              That page does not exist, or the record it referred to has been removed.
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
