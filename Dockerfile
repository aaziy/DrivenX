# syntax=docker/dockerfile:1
#
# One image for the web app, the worker and the one-off tools. They share a repository,
# a lockfile and a Prisma client, and three images would mean three builds of the same
# code that could drift. Which one a container is, is decided by its command.
#
# Linux (Debian) rather than Alpine: the Prisma engine and the argon2 binding both ship
# prebuilt glibc binaries, and musl is where "works on my machine" goes to die.

FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true

# openssl: Prisma's query engine links against it. ca-certificates: outbound TLS (SMTP, S3).
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /app

FROM base AS build

COPY . .

# Dev dependencies stay: the worker runs through tsx and migrations through the Prisma
# CLI, and both are dev dependencies. A pruned image would be smaller and unable to
# migrate itself.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# Generated for this platform, which is why the host's copy is excluded from the context.
RUN pnpm db:generate

RUN pnpm --filter @drivenx/web build

FROM build AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Asia/Dubai

# Next writes its image and fetch cache here at run time. Everything else is read-only
# to the application, so it can stay owned by root.
RUN mkdir -p apps/web/.next/cache && chown -R node:node apps/web/.next/cache

USER node

EXPOSE 3000

CMD ["pnpm", "--filter", "@drivenx/web", "start"]
