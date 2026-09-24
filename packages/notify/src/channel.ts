/**
 * The delivery port (P3-01, SOW §16).
 *
 * SOW §16 asks for in-app, then email, then WhatsApp. They are three ways of reaching
 * the same person about the same thing, so they are one interface with three adapters
 * rather than three code paths that drift — which matters most for the one that does not
 * exist yet: WhatsApp arrives as another adapter and a row in the delivery log, not as a
 * second notification system alongside this one.
 *
 * An adapter never decides *whether* to send. It is handed a rendered message and an
 * address and does one thing with them. Who should be told, and whether they want to be,
 * is settled before anything reaches here — because those are questions about
 * permissions and preferences, and an adapter that answered them would be a second place
 * for the visibility rule to live.
 */

import type { DeliveryChannel } from "@drivenx/core";

export interface RenderedMessage {
  /** A subject line for the channels that have one. */
  subject: string;
  /** Plain text. Every channel can carry this; only some can carry more. */
  text: string;
  /** Where the recipient should land, absolute, for channels that can link. */
  url?: string | undefined;
}

export interface DeliveryAttempt {
  /** An email address, a phone number: whatever this channel addresses people by. */
  recipient: string;
  message: RenderedMessage;
  /** The reader's language, for channels that format around the text. */
  locale: "en" | "ar";
}

export type DeliveryOutcome =
  | { ok: true; detail?: string }
  /**
   * `retryable` separates "the provider is down" from "that address is not real".
   * Retrying the first is right and retrying the second is a loop that never ends and
   * fills the log with the same failure.
   */
  | { ok: false; error: string; retryable: boolean };

export interface NotificationChannelAdapter {
  readonly channel: DeliveryChannel;
  /** Whether this adapter is configured well enough to be used at all. */
  isConfigured(): boolean;
  send(attempt: DeliveryAttempt): Promise<DeliveryOutcome>;
}
