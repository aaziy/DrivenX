/**
 * Vitest setup for the integration and reconciliation projects.
 * Registered via `setupFiles` in vitest.config.ts.
 */

import { afterAll, beforeAll, beforeEach } from "vitest";

import { assertTestDatabase, prisma, truncateAll } from "./testing";

beforeAll(() => {
  assertTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await prisma.$disconnect();
});
