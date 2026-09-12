"use client";

/**
 * Last-resort boundary: catches failures in the root layout itself, where the normal
 * error boundary has no shell to render into. It must supply its own html and body,
 * and cannot rely on the stylesheet having loaded.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          margin: 0,
          background: "#f6f7f9",
          color: "#16202e",
        }}
      >
        <main style={{ maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>DrivenX is temporarily unavailable</h1>
          <p style={{ color: "#5b6878", lineHeight: 1.55 }}>
            The application failed to start. Nothing you were working on has been saved.
          </p>
          {error.digest ? (
            <p style={{ color: "#5b6878", fontSize: 13 }}>
              Reference: <code>{error.digest}</code>
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 16,
              padding: "8px 14px",
              border: "none",
              borderRadius: 5,
              background: "#14532d",
              color: "#fff",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
