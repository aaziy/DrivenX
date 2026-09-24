# How DrivenX is built

SOW §20 requires technical documentation as a handover deliverable. This is it — written
for a developer who has just been handed the repository and needs to know where things
are and, more usefully, why they are there.

For the data model read [database.md](database.md). For running it read
[deployment.md](deployment.md).

---

## 1. The sentence the whole system is arranged around

The SOW's closing developer note is the real specification:

> The database architecture and financial calculation engine are critical. The system
> should be designed so DrivenX can later support normal rental, long-term rental,
> lease-to-own, B2B fleet management and vehicle brokerage without rebuilding the core
> system.

Everything else in that document is CRUD around it. So the core was built first —
identity, parties, fleet, contracts, money — and features hang off it. Screens came last,
deliberately.

Three consequences show up everywhere in this codebase, and they are the things not to
undo:

1. **Profit is a `GROUP BY`, never a column.** One append-only ledger, every report a
   different grouping of it. This is what let Phase 2 add maintenance, fines, repairs,
   claims and expenses without touching the reporting layer once.
2. **Money is `BigInt` fils.** No float, no decimal, one rounding rule, applied once.
3. **Permissions are data.** `can(user, "contract.approve")`, never
   `user.role === "admin"`. The client edits roles at runtime, and a role-name check would
   have to be found and fixed at every call site the first time they reorganised.

## 2. Shape

```
apps/
  web/       Next.js App Router — every screen and server action
  worker/    scheduled jobs; runs one and exits

packages/
  core/      the domain layer. zero framework imports, zero I/O
  db/        Prisma client, schema, migrations, data access
  auth/      sessions, RBAC, the permission catalogue
  storage/   S3-compatible document storage behind a port
  notify/    notification delivery behind a port
  logger/    structured logging
```

The dependency direction, which is enforced by nothing but matters:

```
core ← db ← auth ← web, worker
core ← logger ← notify ← worker
storage ← web
```

`core` depends on nothing. That is the rule worth defending: it means the pricing engine,
the schedule expansion, the state machines and the money arithmetic can be tested without a
database, a server or a browser, and can be lifted into the public API that §18 anticipates
without carrying Next.js along with them.

Note `auth` depends on `db`. That has one consequence worth remembering: anything in `db`
that wants the permission catalogue creates a cycle. When notification delivery needed to
know who may see a notification, the answer was to put that logic in the *worker*, which
may depend on both, rather than in `db`. If you hit the same wall, that is the way out.

## 3. Patterns that recur

Recognising these makes the codebase much smaller than it looks.

### Ports and adapters

`storage` and `notify` are interfaces with swappable implementations. Storage speaks
S3-compatible rather than any vendor's SDK; notification delivery speaks SMTP rather than
one provider's HTTP API. Both exist because §20 requires DrivenX to own what they run —
changing provider must be a change of environment variables, not of code.

When WhatsApp arrives it is one more adapter behind the same interface, not a second
notification system beside this one.

### State machines with explicit transition tables

Vehicles, contracts, payments, leads, fines, accidents and insurance claims each have a
table of legal transitions in `core`, and an illegal one throws. Every transition writes a
history row.

This is what prevents the classic corruption — "vehicle is Rented but has no active
contract" — and it has a second benefit worth knowing: screens ask the machine what is
possible rather than hardcoding buttons, so a screen cannot offer a move the service will
refuse. A user interface that teaches people it might reject them is one they stop trusting.

### Exhaustive `Record`s as build-time guards

Several maps are typed `Record<SomeEnum, X>` specifically so that adding an enum member
fails the build until every place that must handle it does. Examples: notification
visibility, the revenue category per charge type, the document owner → path map.

This is the cheapest form of test in the repository and it has caught real mistakes.

### Catalogue coverage tests

Where the compiler cannot help — message catalogues are JSON — a test iterates the
canonical list instead: every permission, every role, every charge type, every ledger
category and every notification type has a label in both English and Arabic, or the suite
fails. Each of these tests exists because something once shipped without one. A charge type
reached a payment schedule as a raw key; that is why `CHARGE_TYPES` is now a runtime list.

### Idempotency by key, not by hope

Anything that a retried job could do twice is protected by a unique key rather than by
checking first and then writing:

- notifications deduplicate on a key per record per reminder offset
- deliveries claim a row unique across notification, channel and recipient before sending
- ledger postings are unique on source and category

The pattern is always the same: claim, then act. Check-then-act loses a race.

## 4. The web app

Next.js App Router, server components by default, **server actions rather than a REST API
for the application's own use.** Every action begins with `requirePermission(...)`, which
throws if the session lacks it — authorisation is at the mutation, not at the route.

Two conventions worth knowing before writing a screen:

- **A success message has to have somewhere to render.** Several actions return no message
  because the thing that would display it disappears on success — signing a handover
  replaces the form with the signed record. The state change is the evidence. This has
  caught me three times; if a test cannot find your success text, check whether the form
  still exists.
- **Localisation is by re-rendering, not by storing text.** Notifications store English
  title and body, and the screen re-renders them from the type and the record. Email cannot
  do that — it is written once and read later — so it renders in the recipient's language
  at send time. Arabic is a full mirror, RTL, including the PDFs.

## 5. Testing

Four layers, three vitest projects, one Playwright suite:

| Command | What it covers |
|---|---|
| `pnpm test:unit` | Pure domain logic. No database, no network. ~880 tests, about a second |
| `pnpm test:integration` | Every write path, against a real Postgres. ~300 tests |
| `pnpm test:reconciliation` | The financial invariants across the golden dataset |
| `pnpm test:e2e` | Playwright, real browser, real app. ~95 journeys |

Integration files run **serially** (`singleFork`), because they truncate shared tables and
two at once would delete each other's fixtures. This is set per-project;
`fileParallelism` is a root-level option that Vitest silently ignores inside a project,
which showed up once as failures that vanished when either file ran alone.

The E2E database accumulates across runs. Tests must therefore be written to be repeatable:
stamp identifiers, and never assert on an aggregate that grows — a count or a running total
will pass the first time and fail the second.

There is also a screenshot spec, off unless `SHOT_DIR` is set. It is not an assertion; it
exists because Phase 0 shipped a permission editor that was invisible on screen while every
test passed, and it was found by looking at a picture. Several presentation faults in later
phases were found the same way, after the tests were already green.

## 6. Known debts

Stated plainly, because a handover that hides them is worse than one that admits them.

- **The audit log is not transactionally atomic** with its mutation on every path, and raw
  SQL bypasses it entirely. The fix — Postgres triggers with the actor passed via
  `SET LOCAL` — is scheduled into P4-02 and closes both.
- **The Arabic is an unreviewed draft.** The client accepted it provisionally. It is now on
  contracts and handover reports that customers sign, and it needs a fluent reader.
- **No production deployment exists**, and backups are not built. Both wait on the VPS.
- **The repository has never been Prettier-formatted** and CI does not check it. `pnpm
  format` rewrites about 125 files. Adopt it in one commit or drop the script.
- **A tax invoice has no page of its own.** Contracts, statements and handover reports
  print; the invoice layout waits on DrivenX's TRN and the numbering the FTA expects.

## 7. Where the decisions are written down

- `PROJECT_PLAN.md` — what is being built and why. §2 locked decisions, §3 architecture
  principles, §8 the client questions and their answers with dates.
- `IMPLEMENTATION_PLAN.md` — how and in what order, task by task, with a status column and
  a note on each finished task saying what was actually built and what was decided along
  the way.
- `docs/open-items.md` — everything blocked on somebody outside the repository.
- Commit messages carry the reasoning for anything non-obvious. `git log` is deliberately
  part of the documentation.
