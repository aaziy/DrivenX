/**
 * Seed the golden dataset (P0-12).
 *
 * Development and QA only — never production. Guarded, because these accounts share a
 * published password and a real deployment carrying them would be an open door.
 *
 * Idempotent and deterministic: running it twice leaves the database in exactly the
 * same state, which is the property the P0-12 test asserts.
 */

import { hashPassword } from "@drivenx/auth/password";

import { GOLDEN_PASSWORD, GOLDEN_USERS } from "../src/golden/dataset";
import { prisma, withoutAudit } from "../src/index";

export async function seedGoldenDataset(): Promise<void> {
  const roles = await prisma.role.findMany({ select: { id: true, key: true } });
  const roleIdByKey = new Map(roles.map((role) => [role.key, role.id]));

  if (roleIdByKey.size === 0) {
    throw new Error("Run the base seed first (pnpm db:seed) — no roles exist.");
  }

  // Hashed once rather than per user: argon2 is deliberately slow, and eight
  // sequential hashes at OWASP parameters is most of this script's runtime.
  const passwordHash = await hashPassword(GOLDEN_PASSWORD);

  await withoutAudit(async () => {
    for (const user of GOLDEN_USERS) {
      await prisma.user.upsert({
        where: { id: user.id },
        update: {
          email: user.email,
          fullName: user.fullName,
          phone: user.phone,
          isActive: user.isActive,
          // Reset the lockout state so a previous test run cannot leave an account
          // locked and break the next one.
          failedLogins: 0,
          lockedUntil: null,
          // Reset the language too. E2E specs read English text, and one persona left in
          // Arabic by an earlier run would fail every spec that signs in as it.
          locale: "en",
        },
        create: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          phone: user.phone,
          isActive: user.isActive,
          passwordHash,
        },
      });

      const roleId = user.roleKey ? roleIdByKey.get(user.roleKey) : undefined;
      if (user.roleKey && !roleId) {
        throw new Error(`Golden user ${user.email} references unknown role "${user.roleKey}".`);
      }

      // Replace assignments so the dataset converges regardless of prior state.
      await prisma.userRole.deleteMany({
        where: { userId: user.id, ...(roleId ? { NOT: { roleId } } : {}) },
      });
      if (roleId) {
        await prisma.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId } },
          update: {},
          create: { userId: user.id, roleId },
        });
      }
    }
  });
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to seed the golden dataset in production: these accounts share a known password.",
    );
  }

  console.log("Seeding golden dataset...");
  await seedGoldenDataset();

  console.log(`  users: ${GOLDEN_USERS.length}`);
  for (const user of GOLDEN_USERS) {
    console.log(`    ${user.email.padEnd(32)} ${user.note}`);
  }
  console.log(`\n  password for all golden accounts: ${GOLDEN_PASSWORD}`);
  console.log("Golden dataset complete.");
}

// Only run when invoked directly, so the integration test can import the seeder.
if (process.argv[1]?.includes("seed-golden")) {
  main()
    .catch((error: unknown) => {
      console.error("Golden seed failed:", error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
