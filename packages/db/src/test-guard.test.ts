import { describe, expect, it } from "vitest";

import { isTestDatabaseUrl, redactUrl } from "./test-guard";

describe("isTestDatabaseUrl", () => {
  it.each([
    "postgresql://drivenx:pw@localhost:5433/drivenx_test",
    "postgresql://drivenx:pw@localhost:5433/drivenx_test?schema=public",
    "postgresql://user@host/app_test?connection_limit=1&pool_timeout=0",
    "postgres://host/x_test",
  ])("accepts %s", (url) => {
    expect(isTestDatabaseUrl(url)).toBe(true);
  });

  it.each([
    ["postgresql://drivenx:pw@localhost:5433/drivenx", "the development database"],
    ["postgresql://drivenx:pw@localhost:5433/drivenx?schema=public", "development with params"],
    ["postgresql://user@host/production", "production"],
    ["", "empty"],
  ])("rejects %s (%s)", (url) => {
    expect(isTestDatabaseUrl(url)).toBe(false);
  });

  it("does not accept a production database because a query param contains _test", () => {
    // A naive /_test/ search over the whole URL would pass this and truncate production.
    expect(isTestDatabaseUrl("postgresql://user@host/production?application_name=some_test")).toBe(
      false,
    );
  });

  it("does not accept a non-test database on a host whose name ends in _test", () => {
    expect(isTestDatabaseUrl("postgresql://user@db_test:5432/drivenx")).toBe(false);
  });

  it("requires _test as a suffix, not merely a substring", () => {
    expect(isTestDatabaseUrl("postgresql://host/drivenx_testing")).toBe(false);
    expect(isTestDatabaseUrl("postgresql://host/testdb")).toBe(false);
  });
});

describe("redactUrl", () => {
  it("removes credentials", () => {
    expect(redactUrl("postgresql://drivenx:secret@localhost:5433/drivenx_test")).toBe(
      "postgresql://***@localhost:5433/drivenx_test",
    );
  });

  it("leaves a credential-free URL untouched", () => {
    expect(redactUrl("postgresql://localhost:5433/drivenx_test")).toBe(
      "postgresql://localhost:5433/drivenx_test",
    );
  });
});
