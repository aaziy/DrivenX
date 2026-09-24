/**
 * @drivenx/notify — one interface for reaching people, one adapter per channel (P3-01).
 *
 * In-app is not here: it is the notification row itself, written by whatever raised it,
 * and it is the only channel that cannot fail. This package is about the channels that
 * reach somebody who is not looking at the screen.
 */

export * from "./channel";
export * from "./templates";
export { createConsoleAdapter, type ConsoleAdapterOptions } from "./adapters/console";
export { createSmtpAdapter, smtpConfigFromEnv, type SmtpConfig } from "./adapters/smtp";

import { createConsoleAdapter } from "./adapters/console";
import { createSmtpAdapter, smtpConfigFromEnv } from "./adapters/smtp";
import type { NotificationChannelAdapter } from "./channel";

/**
 * The email adapter for this environment.
 *
 * Real SMTP when it is configured, and the console otherwise. The fallback is deliberate
 * and deliberately loud: a system with no mail server should still exercise the whole
 * path and say what it would have sent, rather than quietly doing nothing and looking
 * exactly like one that works.
 */
export function emailAdapterFromEnv(env: NodeJS.ProcessEnv = process.env): NotificationChannelAdapter {
  const config = smtpConfigFromEnv(env);
  return config ? createSmtpAdapter(config) : createConsoleAdapter();
}
