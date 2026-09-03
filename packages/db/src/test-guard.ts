/**
 * Safety guard for the integration test harness.
 *
 * Lives in its own module, free of any Prisma import, so it can be unit tested
 * without constructing a client. It is the only thing preventing a misconfigured
 * DATABASE_URL from truncating a real database, so it gets its own tests.
 */

/** Does this connection string name a dedicated test database? */
export function isTestDatabaseUrl(url: string): boolean {
  if (!url) return false;

  // Match the database name segment only — the path component after the final "/",
  // stopping at any query string. Checking the whole URL would wrongly accept
  // "postgres://user@host/production?options=some_test" or a host named "db_test".
  const match = /\/([^/?#]+)(?:[?#]|$)/.exec(url.replace(/^[a-z]+:\/\/[^/]*/i, ""));
  const databaseName = match?.[1];

  return databaseName !== undefined && /_test$/.test(databaseName);
}

/** Redact credentials before a connection string reaches a log or an error message. */
export function redactUrl(url: string): string {
  return url.replace(/:\/\/[^@/]*@/, "://***@");
}
