# Running DrivenX

SOW §20 requires a deployment runbook as a handover deliverable. This is it.

Everything needed to run DrivenX in production is in the repository: an image, a
production compose file, HTTPS, the job schedule, encrypted backups and a restore
rehearsal (§6). The whole stack was run end to end on a development machine — a real
browser signing in over HTTPS, uploading a 4 MB scan and downloading it back intact, every
nightly job, and a backup restored and counted.

What has not happened yet is running it on a real server, because that server has to be
in DrivenX's own name (see [open-items.md](open-items.md), Q11). §6 is the procedure for
the day it exists.

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
wrong database. If 5433 is taken too, set `POSTGRES_PORT` in `.env` and use the same port
in both database URLs. Symptom of getting this wrong: `P1010: User was denied access`.

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

## 6. Production

### What is in `deploy/`

| File | What it is |
|---|---|
| `Dockerfile` (repository root) | One image for the web app, the worker and the one-off tools |
| `docker-compose.prod.yml` | Postgres, the document store, the app, and Caddy. **Only Caddy publishes a port** — the database and store are reachable from inside Docker alone |
| `deploy/Caddyfile` | HTTPS with automatic certificates, HSTS, a 14 MB request limit |
| `deploy/env.production.example` | Every setting the server needs, with how to generate each secret |
| `deploy/server-setup.sh` | Once, as root, on a fresh Ubuntu 24.04: timezone, Docker, firewall, a `drivenx` user, the backup passphrase |
| `deploy/deploy.sh` | Every deploy: back up, build, migrate, restart. `--first-run` also creates the bucket and the first admin |
| `deploy/crontab` | The four nightly jobs and the 03:30 backup |
| `deploy/backup.sh` | Encrypted backup of the database **and** the documents |
| `deploy/restore-check.sh` | Restores a backup into a scratch database, counts it, drops it |

**What has been proven, and how.** On a development machine, under a separate project name
so it could not touch development data: migrations, bucket creation and seeding inside the
production image; the app healthy behind Caddy; plain HTTP redirecting to HTTPS; HSTS and
the security headers present; a browser signing in as the seeded admin with a session
cookie marked `Secure` and `HttpOnly`; a customer created and a 4 MB scan uploaded and
downloaded back byte for byte; all four jobs exiting cleanly; and a backup restored into a
scratch database with the row counts and the ledger's append-only trigger intact.

`server-setup.sh` is the one piece **not yet run anywhere**. It needs a real server to be
proven on. Read it before running it.

### Bringing up a new server

1. **Point the domain at the server.** An `A` record for the subdomain DrivenX will use
   (for example `app.` on the Hostinger domain), set to the VPS's IP. Do this first:
   Caddy requests the certificate on the first start and fails if the domain does not
   reach the server yet.
2. **As root:** run `deploy/server-setup.sh`. It prints a backup passphrase location —
   **copy `/etc/drivenx/backup.pass` off the server immediately.** The backups cannot be
   decrypted without it, and if the server is lost the passphrase is lost with it.
3. **As the `drivenx` user** (`su - drivenx`):
   ```bash
   git clone <repository> /opt/drivenx
   cd /opt/drivenx
   cp deploy/env.production.example .env    # fill in every line; generate secrets here
   deploy/deploy.sh --first-run
   crontab deploy/crontab
   ```
4. **Check it.** Open the site, sign in as the `SEED_ADMIN_EMAIL` with its password, and
   change the password straight away from **Your account** at the bottom of the sidebar.
   Then remove `SEED_ADMIN_PASSWORD` from `.env` — it has done its job, and a password
   sitting in a file is a password.
5. **Prove the backup.** Run `deploy/backup.sh`, then `deploy/restore-check.sh` on the file
   it wrote, and write the elapsed time below. P4-01 is not done until this has happened on
   the real server.

   > Restore rehearsal on the production server: *not yet performed.*

### Updating

```bash
cd /opt/drivenx && deploy/deploy.sh
```

It backs up, pulls, builds, migrates and restarts, in that order. The site is down for the
seconds the web container takes to restart.

### Restoring for real

Deliberately not a script — replacing the live database should be a decision somebody
makes with the site stopped, not a command that can be run by accident.

```bash
cd /opt/drivenx
docker compose -f docker-compose.prod.yml stop web caddy
docker compose -f docker-compose.prod.yml exec -T postgres dropdb -U drivenx drivenx
docker compose -f docker-compose.prod.yml exec -T postgres createdb -U drivenx drivenx
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/etc/drivenx/backup.pass -in <db-backup> \
  | docker compose -f docker-compose.prod.yml exec -T postgres pg_restore -U drivenx -d drivenx --no-owner
docker compose -f docker-compose.prod.yml up -d web caddy
```

Documents are restored by stopping `s3` and unpacking the matching `files-*` archive into
the `drivenx_s3data` volume. Restore the database and documents **from the same night**:
a database from Tuesday with documents from Monday knows about a signed form it cannot show.

### Decisions still open

- **Backups must leave the server.** `backup.sh` keeps them on the same disk as the data
  unless `BACKUP_RSYNC_TARGET` is set, and says so on every run. A backup on the disk it
  protects survives a bad deploy and nothing else.
- **The document store is a release candidate.** `rustfs/rustfs:1.0.0-rc.6` was chosen for
  development when MinIO's images disappeared. Running it for scanned Emirates IDs is a
  judgement call; the alternative is a managed S3-compatible service (Cloudflare R2,
  Backblaze B2, AWS), which needs only `S3_ENDPOINT` and the keys changed in `.env` — no code.
- **The image is about 2 GB.** It keeps development dependencies so the worker can run
  through `tsx` and migrations through the Prisma CLI. Fine on one server with a 100 GB
  disk; worth slimming if images are ever shipped through a registry.

### Still to do in Phase 4

- **Security pass (P4-02).** Rate limiting on sign-in beyond the existing lockout,
  at-rest encryption for documents, a dependency audit. The audit log is not
  transactionally atomic with its mutation on every path, and raw SQL bypasses it; the fix
  is Postgres triggers with the actor passed via `SET LOCAL`.
- **Load test (P4-04, blocked — Q10).** Benchmarked at 5,000 contracts and 195,000
  instalments: worst p95 107 ms against a 500 ms budget. The target is 3× the projected
  fleet, and the projection has not been given.

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
