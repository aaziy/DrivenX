/**
 * @drivenx/core — the domain layer.
 *
 * Pure logic only. Nothing in this package may import from Next.js, Prisma Client or
 * any other framework: it must stay callable from the web app, the worker, tests, and
 * whatever API surface Phase 3 adds (SOW §18).
 */

export * as Money from "./money";
export type { Fils } from "./money/money";
export * from "./redaction";
export * from "./identifiers";
export * from "./time";
export * from "./parties/codes";
export * from "./documents/expiry";
export * from "./documents/categories";
export * from "./fleet/status";
export * from "./fleet/mileage";
export * from "./fleet/vehicle";
export * from "./pricing/deal";
export * from "./contracts";
export * from "./leads/status";
