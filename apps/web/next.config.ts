import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { NextConfig } from "next";

/**
 * Load the monorepo-root .env.
 *
 * Next only looks for .env beside the app, but the database, storage and auth
 * configuration is shared with the worker, the seed script and the test suite — so it
 * lives at the root and is read from there. Duplicating it per app is how the two
 * copies drift and a deploy picks up the wrong bucket.
 */
for (const candidate of ["../../.env", ".env"]) {
  const path = resolve(process.cwd(), candidate);
  if (existsSync(path)) {
    process.loadEnvFile(path);
    break;
  }
}

const config: NextConfig = {
  reactStrictMode: true,

  // The floating dev badge renders in a portal that intercepts pointer events, which
  // makes every Playwright click in development flaky (P0-14).
  devIndicators: false,

  // Workspace packages ship TypeScript source rather than build output, so Next
  // compiles them itself. Keeps the monorepo free of a build step per package.
  transpilePackages: ["@drivenx/core", "@drivenx/db", "@drivenx/auth", "@drivenx/storage"],

  serverExternalPackages: ["@prisma/client", "@node-rs/argon2"],

  experimental: {
    // Enables forbidden()/unauthorized() and the forbidden.tsx boundary, so a
    // permission failure renders 403 rather than being conflated with "not signed in".
    authInterrupts: true,
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
