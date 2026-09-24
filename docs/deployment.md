# Running DrivenX

SOW §20 requires a deployment runbook as a handover deliverable. This is it.

**Read this first: nothing is deployed yet.** There is no production server, no
Dockerfile for the application, and no automated deploy. That is not an oversight — the
VPS has to exist in DrivenX's own name before any of it can be built, and that account is
still outstanding (see [open-items.md](open-items.md), Q11).

So this document has two halves. §1–§5 describe what exists today and can be relied on.
§6 lists exactly what is still to be built, so that the day the server appears the work is
mechanical rather than exploratory.

---

## 1. What the system is made of

Four processes, two of which are stateful:

| Part | What it is | State |
|---|---|---|
| `apps/web` | Next.js (App Router). The whole interface and every server action. | none |
| `apps/worker` | A CLI that runs one job and exits. Cron decides when. | none |
| PostgreSQL 16 | Every record. The only thing whose loss is unrecoverable. | **all of it** |
| S3-compatible storage | Uploaded documents, photographs, signatures. | **files** |

The worker is deliberately not a daemon. Each invocation runs one job and exits, so a
failure surfaces in cron's output rather than dying quietly inside a long-lived process
nobody is watching.

**Requirements:** Node 22 or later, pnpm 10.28.2 (pinned in `packageManager`), and
PostgreSQL 16. The application holds no state of its own, so it can be restarted at any
moment without ceremony.

## 2. Configuration

Everything is environment variables, read from a single `.env` at the repository root —
the web app, the worker, the seed script and the test suite all read the same file. Next
only looks for `.env` beside the app, so `next.config.ts` loads the root one explicitly;
duplicating it per app is how two copies drift and a deploy picks up the wrong bucket.

`.env` is gitignored and has never been committed. `.env.example` lists every variable
with a comment.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `TEST_DATABASE_URL` | tests only | Must name a `*_test` database — the harness refuses otherwise, because the integration suites truncate every table |
| `AUTH_SECRET` | **yes** | Signs the session cookie. The app throws on boot without it. Generate with `openssl rand -base64 32`. **Changing it signs everybody out.** |
| `AUTH_MAX_FAILED_ATTEMPTS`, `AUTH_LOCKOUT_MINUTES` | no | Lockout policy; sensible defaults |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | yes | Any S3-compatible service |
| `S3_FORCE_PATH_STYLE` | no | `true` for RustFS and MinIO; false for AWS |
| `S3_MAX_UPLOAD_BYTES` | no | Defaults to 10 MB. The form's "up to N MB" hint reads the same value, so the two cannot disagree |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | no | Unset, email is written to the log instead of sent — loudly, so an unconfigured install is not mistaken for a working one |
| `APP_URL` | yes once email is on | Where links in an email point |
| `TZ` | yes | `Asia/Dubai`. Calendar dates are stored at UTC midnight and formatted in UTC, but the worker's idea of "today" comes from here |
| `NODE_ENV`, `LOG_LEVEL` | yes | `production` and `info` in production |

## 3. Development

```bash
pnpm install
cp .env.example .env          # then set AUTH_SECRET
pnpm docker:up                # Postgres on 5433, S3 on 9000
pnpm storage:ensure-bucket    # waits for the service, then creates the bucket
pnpm db:migrate:deploy
pnpm db:seed                  # roles, permissions, document categories
pnpm db:seed:golden           # optional: realistic UAE test data
pnpm dev
```

Postgres publishes on **5433, not 5432**, because a native Postgres on the developer's
machine would otherwise win the `localhost` race and connections would silently reach the
wrong database.

## 4. The jobs

Four, each idempotent and safe to run twice:

| Job | What it does | Suggested time |
|---|---|---|
| `expiry-scan` | Documents and insurance policies approaching expiry → notifications at 60/30/15/7 days | 02:00 |
| `contracts-daily` | Instalments Upcoming → Due → Overdue, and issues what has fallen due | 02:15 |
| `maintenance-due` | Cars approaching a service by date or distance | 02:30 |
| `deliver-notifications` | Sends what has been raised, one message per person | 07:00 |

```bash
pnpm --filter @drivenx/worker expiry-scan
```

Delivery is deliberately separated from raising. Raising is a database decision that must
not be held up or rolled back by a mail server being slow; sending is an external call
that will sometimes fail and need another go. And it runs at 07:00 rather than 02:00
because an alert that arrives at two in the morning is read at nine anyway, having woken
somebody's phone for nothing.

Every job is safe to re-run: the scans deduplicate on a key per record per offset, and
delivery claims a row before sending, so a retried job finds nothing left to claim.

## 5. Migrations

```bash
pnpm db:migrate:deploy   # what production runs — applies pending migrations, creates nothing
pnpm db:generate         # regenerate the Prisma client; run after any schema change
```

**Migrations are forward-only.** There is no `down`. A constraint that must change is
dropped explicitly and rebuilt in the same migration. Rolling back a bad migration means
restoring a backup — which is precisely why P4-01 asks for a *tested* restore rather than
a backup script.

Deploy order matters: **migrate before the new application starts.** The schema is
additive in practice, so a brief overlap where the old code runs against the new schema is
survivable; the reverse is not.

## 6. What is still to be built

Each of these is a Phase 4 task. None can be finished without the server existing.

### The VPS (blocked — Q11)

Target is a Hostinger KVM 2 running the same Docker stack as development, **registered in
DrivenX's name**. §20 requires DrivenX to own the hosting outright, so an account in a
developer's name would have to be migrated later, which is worse than waiting.

Until it exists there is no staging environment, and staff cannot try the system against
data they recognise.

### Dockerfiles and a compose file for production (not written)

`docker-compose.yml` today is development only: it runs Postgres and RustFS, and the
application runs on the host. Production needs an image for `apps/web`, an image for
`apps/worker`, and a compose file that puts them behind a reverse proxy with TLS.

Two things that will need deciding then: whether Postgres runs in a container on the same
box (simplest, and the backup story is the same either way) and whether S3 stays RustFS on
the same box or moves to a managed provider.

### Backups and a tested restore (P4-01)

Nothing exists yet. The deliverable is not a backup script — it is a restore that has
actually been performed, with the elapsed time written down. A backup nobody has restored
is a belief, not a backup.

Two things need backing up and they are easy to get wrong separately: the database
(`pg_dump`, encrypted, off the box) and the S3 bucket (documents, signatures, photographs
— losing these means losing the evidence that a customer signed anything).

### Security pass (P4-02)

Rate limiting, at-rest encryption for documents, dependency audit, session hardening,
security headers. One item is already known and scheduled here: the audit log is not
transactionally atomic with its mutation on every path, and raw SQL bypasses it entirely.
The fix is Postgres triggers with the actor passed via `SET LOCAL`, which closes both.

### Load test (P4-04, blocked — Q10)

The dashboard and reports were benchmarked at 5,000 contracts and 195,000 instalments: the
worst p95 was 107 ms, comfortably inside the 500 ms budget. But the target is "3× projected
fleet size", and the projection has not been given.

## 7. CI

`.github/workflows/ci.yml` runs on every push: install, bucket, generate, lint, typecheck,
typecheck the E2E project, unit tests, migrate the test database, integration tests,
reconciliation tests, build — then Playwright end-to-end against a real browser in a
second job.

It does **not** run `format:check`, and the repository has never been Prettier-clean.
Running `pnpm format` rewrites about 125 files. Decide whether to adopt it repo-wide in one
commit or drop the script; leaving it as it is means the next person runs it by habit and
produces an enormous unrelated diff.

Pushing a new commit cancels the run in progress for the previous one. That is normal — the
head's result covers everything beneath it — but it means a cancelled run is not a failed
run, and only the current head's verdict is meaningful.
