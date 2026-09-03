/**
 * Request-scoped audit context.
 *
 * The Prisma extension that writes audit rows runs deep inside the query pipeline and
 * has no idea which user triggered the mutation. Threading an actor argument through
 * every repository function would be invasive and — worse — trivially forgotten, which
 * is how audit trails end up with holes exactly where they matter.
 *
 * AsyncLocalStorage carries the actor across every await in a request without touching
 * any function signature. The web layer opens a context once per request; everything
 * beneath it is attributed automatically.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface AuditActor {
  /** Null for system-originated changes: nightly jobs, schedulers, migrations. */
  actorId: string | null;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

/**
 * The storages are pinned to globalThis, for the same reason the Prisma client is.
 *
 * The client is cached across module-registry resets (Next.js hot reload, Vitest's
 * per-file isolation). A cached client's extension closure therefore keeps a reference
 * to the module instance that created it. If the storages were plain module-level
 * constants, a later module instance would allocate *different* ones — the web layer
 * would write the actor into storage A while the extension read from storage B, and
 * every audit row would silently record a null actor.
 *
 * Silently, because nothing throws: you get a complete audit log with no attribution,
 * which is worse than no audit log at all.
 */
const globalForAudit = globalThis as unknown as {
  drivenxAuditActorStorage?: AsyncLocalStorage<AuditActor>;
  drivenxAuditSuppressionStorage?: AsyncLocalStorage<boolean>;
};

const actorStorage = (globalForAudit.drivenxAuditActorStorage ??=
  new AsyncLocalStorage<AuditActor>());
const suppressionStorage = (globalForAudit.drivenxAuditSuppressionStorage ??=
  new AsyncLocalStorage<boolean>());

/** Run `fn` with every mutation inside it attributed to `actor`. */
export function withAuditContext<T>(actor: AuditActor, fn: () => T): T {
  return actorStorage.run(actor, fn);
}

/** The actor for the current async context. Defaults to the system actor. */
export function currentAuditActor(): AuditActor {
  return actorStorage.getStore() ?? { actorId: null };
}

/**
 * Disable audit writes for the duration of `fn`.
 *
 * Intended for seeding and data migrations, where thousands of rows would otherwise
 * bury the genuine user activity that SOW §17 exists to surface. Not for use in
 * application code — if a mutation should not be audited, that is a decision worth
 * arguing for in review, not hiding behind this helper.
 */
export function withoutAudit<T>(fn: () => T): T {
  return suppressionStorage.run(true, fn);
}

export function isAuditSuppressed(): boolean {
  return suppressionStorage.getStore() === true;
}
