/**
 * Automatic audit logging (P0-09, SOW §17).
 *
 * A Prisma client extension that intercepts every mutation and records who changed
 * what, when. Putting it here rather than in each repository function means an audit
 * row cannot be forgotten — the alternative is a hand-written call at every call site,
 * and the one that gets missed is always the one that later matters.
 *
 * Known limitation, deliberately not papered over: the audit row is written after the
 * mutation, through the base client, so it does not join an enclosing interactive
 * transaction. If the audit write fails the error propagates (rolling back an enclosing
 * transaction), but a bare mutation outside a transaction will already have committed.
 * Genuine atomicity requires database triggers with the actor passed via `SET LOCAL` —
 * which also closes the raw-SQL bypass. Scheduled into P4-02 and recorded in the risk
 * register rather than left as a surprise.
 */

import type { Prisma as PrismaNamespace, PrismaClient } from "../../generated/client";
import { Prisma } from "../../generated/client";

import { currentAuditActor, isAuditSuppressed } from "./context";
import { diffRecords, sanitiseRecord } from "./serialise";

/** Never audited: the audit table itself, or we recurse forever. */
const EXCLUDED_MODELS = new Set(["AuditLog"]);

type AnyRecord = Record<string, unknown>;
type JsonOrNull = PrismaNamespace.InputJsonValue | typeof Prisma.DbNull;

interface AuditEntry {
  entityType: string;
  entityId: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  before: JsonOrNull;
  after: JsonOrNull;
}

/** Minimal shape needed for dynamic model access; Prisma exposes no index signature. */
type ModelDelegates = Record<string, { findMany?: (args: unknown) => Promise<AnyRecord[]> }>;

/** `RolePermission` -> `rolePermission`, matching the Prisma client's delegate names. */
function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Rewrite a unique `where` into one `findMany` accepts.
 *
 * `update` and `delete` take compound unique keys in wrapped form —
 * `{ roleId_permissionId: { roleId, permissionId } }` — which `findMany` rejects
 * outright. Without this, every mutation on a join table silently failed its "before"
 * read and produced an audit row with no previous state. Those tables are
 * `role_permissions` and `user_roles`: exactly the rows recording who granted or
 * revoked access, which is the first thing anyone asks the audit log about.
 */
export function flattenUniqueWhere(where: unknown): unknown {
  if (!where || typeof where !== "object" || Array.isArray(where)) return where;

  const output: AnyRecord = {};

  for (const [key, value] of Object.entries(where as AnyRecord)) {
    const isWrapper =
      key.includes("_") && value !== null && typeof value === "object" && !Array.isArray(value);

    if (isWrapper) {
      const innerKeys = Object.keys(value as AnyRecord);
      const matchesCompoundName =
        innerKeys.length > 1 &&
        key.split("_").slice().sort().join("_") === innerKeys.slice().sort().join("_");

      if (matchesCompoundName) {
        Object.assign(output, value);
        continue;
      }
    }

    output[key] = value;
  }

  return output;
}

/**
 * Stable identifier for an audited row.
 *
 * Most models use a cuid `id`, but join tables (RolePermission, UserRole) have
 * composite keys — and those are exactly the rows recording permission changes, so
 * they cannot be skipped. For those we serialise the key fields instead.
 */
function entityIdOf(record: AnyRecord | null, fallback: unknown): string {
  if (record && typeof record["id"] === "string") return record["id"];

  const source = record ?? (fallback as AnyRecord | null);
  if (source && typeof source === "object") {
    const compositeKeys = Object.keys(source)
      .filter((key) => key.endsWith("Id"))
      .sort();
    if (compositeKeys.length > 0) {
      return compositeKeys.map((key) => `${key}=${String(source[key])}`).join(",");
    }
  }

  return "unknown";
}

export function createAuditExtension(base: PrismaClient) {
  const delegates = base as unknown as ModelDelegates;

  /** Read rows through the *base* client so reads are never themselves audited. */
  async function readMany(model: string, where: unknown): Promise<AnyRecord[]> {
    const delegate = delegates[delegateName(model)];
    if (!delegate?.findMany) return [];

    try {
      return await delegate.findMany({ where: flattenUniqueWhere(where) });
    } catch (error) {
      // A "before" snapshot is best-effort — failing to read it must never block the
      // mutation the user asked for. But it is never expected, so it is surfaced
      // rather than swallowed: a silent gap here means an audit row with no history.
      console.warn(
        `[audit] could not read prior state for ${model}:`,
        error instanceof Error ? error.message : error,
      );
      return [];
    }
  }

  async function readOne(model: string, where: unknown): Promise<AnyRecord | null> {
    return (await readMany(model, where))[0] ?? null;
  }

  async function write(entries: readonly AuditEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const actor = currentAuditActor();
    for (const entry of entries) {
      await base.auditLog.create({
        data: {
          entityType: entry.entityType,
          entityId: entry.entityId,
          action: entry.action,
          before: entry.before,
          after: entry.after,
          actorId: actor.actorId,
          ipAddress: actor.ipAddress ?? null,
          userAgent: actor.userAgent ?? null,
          requestId: actor.requestId ?? null,
        },
      });
    }
  }

  function shouldAudit(model: string | undefined): model is string {
    return model !== undefined && !EXCLUDED_MODELS.has(model) && !isAuditSuppressed();
  }

  const asJson = (record: AnyRecord): PrismaNamespace.InputJsonValue =>
    sanitiseRecord(record) as PrismaNamespace.InputJsonValue;

  return Prisma.defineExtension({
    name: "drivenx-audit",
    query: {
      $allModels: {
        async create({ model, args, query }) {
          const result = (await query(args)) as AnyRecord;
          if (!shouldAudit(model)) return result;

          await write([
            {
              entityType: model,
              entityId: entityIdOf(result, (args as AnyRecord)["data"]),
              action: "CREATE",
              before: Prisma.DbNull,
              after: asJson(result),
            },
          ]);
          return result;
        },

        async update({ model, args, query }) {
          if (!shouldAudit(model)) return query(args);

          const where = (args as AnyRecord)["where"];
          const before = await readOne(model, where);
          const result = (await query(args)) as AnyRecord;

          const changes = before ? diffRecords(before, result) : null;
          if (changes) {
            await write([
              {
                entityType: model,
                entityId: entityIdOf(result, where),
                action: "UPDATE",
                before: changes.before as PrismaNamespace.InputJsonValue,
                after: changes.after as PrismaNamespace.InputJsonValue,
              },
            ]);
          }
          return result;
        },

        async delete({ model, args, query }) {
          if (!shouldAudit(model)) return query(args);

          const where = (args as AnyRecord)["where"];
          const before = await readOne(model, where);
          const result = (await query(args)) as AnyRecord;

          await write([
            {
              entityType: model,
              entityId: entityIdOf(before ?? result, where),
              action: "DELETE",
              before: before ? asJson(before) : Prisma.DbNull,
              after: Prisma.DbNull,
            },
          ]);
          return result;
        },

        async updateMany({ model, args, query }) {
          if (!shouldAudit(model)) return query(args);

          const where = (args as AnyRecord)["where"];
          const before = await readMany(model, where);
          const result = await query(args);

          // Re-read by primary key: the original `where` may no longer match these rows
          // once the update has changed the very fields it filtered on.
          const ids = before.map((row) => row["id"]).filter((id) => typeof id === "string");
          const after = ids.length > 0 ? await readMany(model, { id: { in: ids } }) : [];
          const afterById = new Map(after.map((row) => [row["id"], row]));

          const entries = before.flatMap<AuditEntry>((previous) => {
            const next = afterById.get(previous["id"]);
            if (!next) return [];
            const changes = diffRecords(previous, next);
            if (!changes) return [];
            return [
              {
                entityType: model,
                entityId: entityIdOf(previous, where),
                action: "UPDATE",
                before: changes.before as PrismaNamespace.InputJsonValue,
                after: changes.after as PrismaNamespace.InputJsonValue,
              },
            ];
          });

          await write(entries);
          return result;
        },

        async deleteMany({ model, args, query }) {
          if (!shouldAudit(model)) return query(args);

          const where = (args as AnyRecord)["where"];
          const before = await readMany(model, where);
          const result = await query(args);

          await write(
            before.map<AuditEntry>((previous) => ({
              entityType: model,
              entityId: entityIdOf(previous, where),
              action: "DELETE",
              before: asJson(previous),
              after: Prisma.DbNull,
            })),
          );
          return result;
        },

        async upsert({ model, args, query }) {
          if (!shouldAudit(model)) return query(args);

          const where = (args as AnyRecord)["where"];
          const before = await readOne(model, where);
          const result = (await query(args)) as AnyRecord;

          if (!before) {
            await write([
              {
                entityType: model,
                entityId: entityIdOf(result, where),
                action: "CREATE",
                before: Prisma.DbNull,
                after: asJson(result),
              },
            ]);
            return result;
          }

          const changes = diffRecords(before, result);
          if (changes) {
            await write([
              {
                entityType: model,
                entityId: entityIdOf(result, where),
                action: "UPDATE",
                before: changes.before as PrismaNamespace.InputJsonValue,
                after: changes.after as PrismaNamespace.InputJsonValue,
              },
            ]);
          }
          return result;
        },
      },
    },
  });
}
