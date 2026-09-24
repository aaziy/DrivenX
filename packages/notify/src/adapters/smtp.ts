/**
 * Email over SMTP (P3-02).
 *
 * SMTP rather than one provider's HTTP API, for the same reason storage is S3-compatible
 * rather than one vendor's SDK: §20 requires DrivenX to own what they run, and every
 * provider worth using speaks SMTP. Changing provider is then a change of environment
 * variables rather than a change of code, and nothing in this repo has to know whose
 * servers the mail went through.
 *
 * Nothing here decides who to write to. It is handed an address and a rendered message.
 */

import { createTransport, type Transporter } from "nodemailer";

import type { DeliveryAttempt, DeliveryOutcome, NotificationChannelAdapter } from "../channel";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string | undefined;
  password?: string | undefined;
  /** What recipients see in the From line. */
  from: string;
}

export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const host = env["SMTP_HOST"];
  const from = env["SMTP_FROM"];
  // Without a server and a sender there is nothing to configure, and saying so is more
  // useful than half-building a transport that fails on first use.
  if (!host || !from) return null;

  const port = Number(env["SMTP_PORT"] ?? 587);
  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    // 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: env["SMTP_SECURE"] === "true" || port === 465,
    user: env["SMTP_USER"],
    password: env["SMTP_PASSWORD"],
    from,
  };
}

/** Which failures are worth trying again: the transient ones. */
function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string; responseCode?: number } | null)?.code;
  const responseCode = (error as { responseCode?: number } | null)?.responseCode;

  // A 4xx from SMTP is "try later"; a 5xx is "this will never work".
  if (typeof responseCode === "number") return responseCode >= 400 && responseCode < 500;
  // No response at all: the network or the server, both worth another go.
  return code === undefined || ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN"].includes(code);
}

export function createSmtpAdapter(config: SmtpConfig): NotificationChannelAdapter {
  let transporter: Transporter | null = null;

  const transport = () => {
    transporter ??= createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(config.user ? { auth: { user: config.user, pass: config.password ?? "" } } : {}),
    });
    return transporter;
  };

  return {
    channel: "EMAIL",
    isConfigured: () => Boolean(config.host && config.from),
    async send(attempt: DeliveryAttempt): Promise<DeliveryOutcome> {
      try {
        const info = await transport().sendMail({
          from: config.from,
          to: attempt.recipient,
          subject: attempt.message.subject,
          text: attempt.message.text,
        });
        return { ok: true, detail: info.messageId };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          retryable: isRetryable(error),
        };
      }
    },
  };
}
