import { describe, expect, it } from "vitest";

import { smtpConfigFromEnv } from "./smtp";

describe("reading SMTP settings from the environment", () => {
  it("says it is not configured when there is no server or sender", () => {
    // Half a configuration is worse than none: it builds a transport that fails on
    // first use, long after anybody would connect the two facts.
    expect(smtpConfigFromEnv({})).toBeNull();
    expect(smtpConfigFromEnv({ SMTP_HOST: "smtp.example.com" })).toBeNull();
    expect(smtpConfigFromEnv({ SMTP_FROM: "alerts@drivenx.ae" })).toBeNull();
  });

  it("takes the usual defaults", () => {
    const config = smtpConfigFromEnv({ SMTP_HOST: "smtp.example.com", SMTP_FROM: "alerts@drivenx.ae" });
    expect(config).toMatchObject({ host: "smtp.example.com", port: 587, secure: false });
  });

  it("treats 465 as implicit TLS, which it is", () => {
    const config = smtpConfigFromEnv({
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "alerts@drivenx.ae",
      SMTP_PORT: "465",
    });
    expect(config).toMatchObject({ port: 465, secure: true });
  });

  it("takes an explicit secure flag on any port", () => {
    const config = smtpConfigFromEnv({
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "alerts@drivenx.ae",
      SMTP_PORT: "2525",
      SMTP_SECURE: "true",
    });
    expect(config).toMatchObject({ port: 2525, secure: true });
  });

  it("falls back to 587 rather than NaN when the port is nonsense", () => {
    const config = smtpConfigFromEnv({
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "alerts@drivenx.ae",
      SMTP_PORT: "not-a-port",
    });
    expect(config?.port).toBe(587);
  });

  it("carries credentials only when there are some", () => {
    const anonymous = smtpConfigFromEnv({ SMTP_HOST: "h", SMTP_FROM: "f" });
    expect(anonymous?.user).toBeUndefined();

    const authenticated = smtpConfigFromEnv({
      SMTP_HOST: "h",
      SMTP_FROM: "f",
      SMTP_USER: "postmaster",
      SMTP_PASSWORD: "secret",
    });
    expect(authenticated).toMatchObject({ user: "postmaster", password: "secret" });
  });
});
