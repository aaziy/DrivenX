/**
 * The adapter for everywhere that must not send real email (P3-02).
 *
 * Development and CI need the whole path exercised — recipients resolved, templates
 * rendered, the delivery log written — without anything leaving the machine. This
 * records the message and reports success, so a test can assert that the right person
 * would have been told without an inbox to check.
 *
 * It is also the safe default. An unconfigured system that silently sent nothing would
 * look identical to a working one right up until somebody asked why a customer was never
 * chased; this writes a line saying exactly what it would have sent.
 */

import { logger } from "@drivenx/logger";

import type { DeliveryAttempt, DeliveryOutcome, NotificationChannelAdapter } from "../channel";

export interface ConsoleAdapterOptions {
  /** Kept so a test can read back what would have gone out. */
  sink?: DeliveryAttempt[];
}

export function createConsoleAdapter(options: ConsoleAdapterOptions = {}): NotificationChannelAdapter {
  return {
    channel: "EMAIL",
    isConfigured: () => true,
    async send(attempt: DeliveryAttempt): Promise<DeliveryOutcome> {
      options.sink?.push(attempt);
      logger.info("notification.console", {
        recipient: attempt.recipient,
        subject: attempt.message.subject,
        locale: attempt.locale,
      });
      return { ok: true, detail: "console" };
    },
  };
}
