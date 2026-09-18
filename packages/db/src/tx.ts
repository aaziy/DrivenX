import type { DrivenxPrismaClient } from "./index";

/**
 * The client an interactive transaction hands its callback.
 *
 * Not `Prisma.TransactionClient`: that is the plain client's, and ours is wrapped in the
 * audit extension, so its transaction client is a different type. Derived from our own
 * client instead, omitting what a transaction may not call — a superset of those keys, so
 * the real transaction client is always assignable to it.
 */
export type Tx = Omit<
  DrivenxPrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
