# DrivenX — Implementation Plan

Executable companion to [PROJECT_PLAN.md](PROJECT_PLAN.md). That document decides *what and why*;
this one decides *how, in what order, and how we know it works*.

**Status:** Ready to execute · **Last updated:** 2026-09-03

---

## 1. Working agreement

- Work is tracked by **task ID** (`P0-03`, `P1A-07`). One branch per task, one PR per task.
- A task is not done until its tests are written and green. Tests are not a follow-up ticket.
- **Milestones gate on quality, not on calendar.** No milestone starts while a P0 or P1 bug is open
  against the previous one (§3.4).
- Domain logic goes in `packages/core` with zero framework imports. If it needs `next/*` to run, it's
  in the wrong package.
- Every schema change is a Prisma migration, committed. No manual SQL against any environment.

---

## 2. Testing strategy — the parallel track

The point is to catch defects while they are cheap. A financial bug found in Phase 1 is a fix; the
same bug found in Phase 4 has corrupted months of ledger data and needs a migration plus a
reconciliation. So testing runs **beside** development, not after it.

### 2.1 Two-track cadence

```
        ┌──────────────┬──────────────┬──────────────┬──────────────┐
Track A │  build 1A    │  build 1B    │  build 1C    │  build 1D    │   ← development
(dev)   └──────────────┴──────────────┴──────────────┴──────────────┘
        ┌──────────────┬──────────────┬──────────────┬──────────────┐
Track B │  (setup QA)  │  test 1A     │  test 1B     │  test 1C     │   ← QA, one behind
(qa)    └──────────────┴──────────────┴──────────────┴──────────────┘
        ────────────────────────────────────────────────────────────
        regression suite runs on every commit, all milestones, always
```

Track B tests milestone N−1 while Track A builds milestone N. Bugs land back as tasks in the current
sprint, so the developer is still holding the context. Nothing waits for a phase to end.

**If this is a solo build:** the tracks become *days*, not people. Close a milestone, then spend a
dedicated day as QA against the scripted checklist — deliberately trying to break it, not
demonstrating it works. Different mindset, different day. Do not skip it.

### 2.2 The four layers

| Layer | Tool | Scope | Speed | Target |
|---|---|---|---|---|
| **Unit** | Vitest | `packages/core` pure logic — money, pricing, charge expansion, state machines | <2s | ≥90% coverage on `core` |
| **Integration** | Vitest + real Postgres | Repositories, installment generation, ledger posting, RBAC enforcement | <60s | Every write path |
| **Reconciliation** | Vitest + seeded dataset | Financial invariants (§2.3) | <30s | 100% — zero tolerance |
| **E2E** | Playwright | ~12 critical journeys only | <5min | The money paths |

Integration tests run against a real Postgres in Docker, each test in a transaction that rolls back.
No mocked database — the bugs we care about (constraint violations, cascade behaviour, rounding in
aggregates) only appear against the real engine.

**E2E is deliberately thin.** Twelve journeys, not two hundred. E2E is slow and brittle; it exists to
prove the wiring, not the logic. Logic gets tested one layer down.

### 2.3 Financial invariants — the tests that matter most

These run on every commit from 1D onward. Any failure is a build-breaker, no exceptions.

| # | Invariant |
|---|---|
| INV-1 | For any contract: `Σ installments.amountFils == Σ contractCharges expanded` — no rounding drift |
| INV-2 | For any payment: `Σ allocations.amountFils == payment.amountFils` |
| INV-3 | For any installment: `paidFils == Σ its allocations` and `paidFils <= amountFils` |
| INV-4 | For any contract: `Σ ledger REVENUE == Σ instalments.netFils`. VAT is collected for the FTA and is never revenue |
| INV-5 | A contract's consideration is its down payment plus its scheduled charges plus any buyout, all net of VAT. Nothing on a contract is a refundable liability — the client takes no deposits (answered 2026-09-17) |
| INV-6 | Dashboard monthly profit == `Σ ledger revenue − Σ ledger cost` for that `periodMonth` |
| INV-7 | Ledger is append-only — no `UPDATE`/`DELETE` reaches `ledger_entries`; corrections carry `reversesId` |
| INV-8 | Vehicle profitability == `Σ ledger entries WHERE vehicleId` — no orphaned costs |
| INV-9 | Every `ACTIVE` contract has exactly one `RENTED` or `LEASE_TO_OWN` vehicle, and vice versa |
| INV-10 | For any instalment: `grossFils == netFils + vatFils`, and `vatFils` is the rate stored on that instalment applied to `netFils` — so a future rate change cannot rewrite an issued invoice |
| INV-11 | For any supplier invoice: `paidFils == Σ its payments` and `paidFils <= amountFils` |
| INV-12 | For any contract: `Σ ledger cost.supplier == Σ supplier invoices raised` — the lease is costed in the month it is owed, never on payment |

INV-1 is the one that quietly destroys projects. Split AED 3,400 across 36 months naively and you
lose fils to rounding; the contract total no longer matches the sum of its installments; three months
later nobody can explain why the books are off by AED 12. We test it from day one with
largest-remainder allocation.

### 2.4 Golden dataset

> **Sequencing note (resolved during P0-12).** The dataset below describes suppliers,
> vehicles, customers and contracts — none of which exist until milestones 1A–1D. It is
> therefore built incrementally: Phase 0 delivers the deterministic identifier
> generators, the fixed reference clock (`GOLDEN_TODAY`) and one staff account per SOW
> §2 role; each subsequent milestone adds its own entities. The generators are already
> sized for the full set. Staff accounts come first because the two-track cadence in
> §2.1 depends on QA being able to sign in as each persona from 1A onward.

A deterministic seed (fixed IDs, fixed dates, `Math.random` never called) with realistic UAE data:

- Emirates ID `784-YYYY-NNNNNNN-N`, 15-digit TRN, Dubai plates (`A 12345`), UAE mobile `+9715XXXXXXXX`
- 3 suppliers, 25 vehicles (15 company-owned, 10 B2B), 20 customers
- 12 contracts spanning all four types, with hand-calculated expected values in a fixtures file
- Deliberate edge cases: a contract starting on the 31st, a leap-year February, a partially-paid
  installment, an overdue contract, an expired Emirates ID, a document expiring in exactly 30 days

Reconciliation tests assert against the hand-calculated numbers. When a report disagrees with the
fixtures, the report is wrong — that's the whole point of computing them by hand once.

### 2.5 QA checklist per milestone

Each milestone ships with `docs/qa/<milestone>.md`: numbered manual steps, expected result per step,
and a section of **negative cases** (submit the form empty, upload a 50MB file, set an expiry date in
the past, allocate a payment larger than the balance, transition a Sold vehicle to Rented). Negative
cases find more bugs than happy paths and are the first thing skipped under pressure.

### 2.6 UAT

At the close of Phase 1 and Phase 2, real DrivenX staff run their own workflows on staging with their
own data. Booked as a scheduled session, not "have a look when you get a chance." Findings triage
into the normal bug queue.

---

## 3. Quality gates

### 3.1 Definition of Done (per task)
- [ ] Code merged, no `TODO` without a linked task ID
- [ ] Unit tests for new domain logic; integration tests for new write paths
- [ ] Affected financial invariants pass
- [ ] Permission check on every new route and mutation
- [ ] Audit log entry on every new mutation
- [ ] Zod validation on every input boundary
- [ ] Empty, loading and error states on every new screen
- [ ] Seed data updated if the schema changed

### 3.2 Definition of Done (per milestone)
- [ ] All task-level DoD complete
- [ ] QA checklist executed and signed off
- [ ] Zero open P0/P1 bugs
- [ ] Full regression suite green
- [ ] Deployed to staging
- [ ] `docs/` updated (handover docs are written continuously, never at the end — §20)

### 3.3 CI pipeline (from `P0-02` onward)
`lint → typecheck → unit → integration → reconciliation → build → e2e (main only)`
Red pipeline blocks merge. No overrides.

### 3.4 Bug severity

| Sev | Definition | Rule |
|---|---|---|
| **P0** | Data loss, wrong money, security hole, total block | Stop work. Fix now. |
| **P1** | Core feature broken, no workaround | Fix before the next milestone starts |
| **P2** | Broken with a workaround, or wrong in an edge case | Fix within the phase |
| **P3** | Cosmetic, minor UX | Backlog |

Any bug touching money or permissions is **minimum P1**, regardless of how it looks.

---

## 4. Environments

| Env | Purpose | Data |
|---|---|---|
| Local | Development | Golden dataset seed |
| CI | Automated tests | Ephemeral Postgres per run |
| Staging | QA + UAT | Anonymised copy of the golden dataset |
| Production | Live | Real — **restricted access, no developer credentials post-handover (§20)** |

---

## 5. Phase 0 — Foundations

**Goal:** every load-bearing decision implemented and tested before any feature exists.
**Duration:** ~1 week.

| ID | Task | Tests |
|---|---|---|
| P0-01 | Monorepo: pnpm workspaces, `apps/web`, `apps/worker`, `packages/{core,db,auth,ui}`, strict TS | — |
| P0-02 | CI: lint, typecheck, test, build. Branch protection on `main` | Pipeline runs green on empty repo |
| P0-03 | `docker-compose.yml`: Postgres 16 + MinIO + healthchecks. `.env.example` | `docker compose up` reaches healthy |
| P0-04 | Prisma init, connection, migration workflow, base model conventions | Migrate up/down clean |
| P0-05 | **`Money` type**: BigInt fils, `add`/`sub`/`mul`/`allocate`/`format`, largest-remainder split | Unit: 3400 over 36mo sums exactly; 1 fils over 3 ways; negative; zero |
| P0-06 | Auth.js credentials, argon2 hashing, session cookie, password policy, lockout after 5 failures | Integration: login, bad password, lockout, session expiry |
| P0-07 | **RBAC**: permission catalogue, `role_permissions`, `can()`, `requirePermission()` middleware | Integration: permission grant/revoke takes effect without re-login |
| P0-08 | Seed the six SOW roles (§2) as editable defaults | Seed idempotent |
| P0-09 | **Audit log**: Prisma middleware capturing before/after on every mutation | Integration: every write produces exactly one audit row with correct diff |
| P0-10 | Storage interface + MinIO adapter; upload, signed URL, delete, MIME allowlist, 10MB cap | Integration: upload/retrieve round-trip; oversized rejected; `.exe` rejected |
| P0-11 | App shell: layout, nav, auth guard, `DataTable` (sort/filter/paginate/export), `Form` primitive, toasts | E2E: login → dashboard → logout |
| P0-12 | Golden dataset seed script (§2.4) | Seed runs deterministically twice with identical output |
| P0-13 | Error handling: boundaries, structured logging, request IDs | — |
| P0-14 | Playwright setup + first journey | E2E green in CI |

**Exit:** Super Admin logs in, creates an Operations user, edits that role's permissions, sees the
change take effect immediately, and finds both actions in the audit log. Full pipeline green.

---

## 6. Phase 1 — Core

**Duration:** ~5–7 weeks across six milestones.

### 6.1 Milestone 1A — Parties & Documents (~1 wk) · SOW §5, §6, §16

| ID | Task |
|---|---|
| P1A-01 | `Customer` model + migration: code, name, mobile, email, DOB, nationality, address, emergency contact, status |
| P1A-02 | Customer CRUD: list (search/filter/paginate), create, edit, detail, soft delete |
| P1A-03 | `Supplier` model + CRUD: company, contact, phone, email, address, trade licence, TRN, bank details, notes |
| P1A-04 | `DocumentCategory` model, seed defaults, Super Admin management UI (§17) |
| P1A-05 | **`Document` model** — polymorphic `ownerType`/`ownerId`, number, issue, expiry, file, status, reminder offsets |
| P1A-06 | Document upload component: drag-drop, preview, replace, version history |
| P1A-07 | **Expiry scan job** — nightly, all owner types, `dedupeKey` to guarantee one notification per document per offset |
| P1A-08 | `Notification` model + in-app centre: unread badge, mark read, deep-link to entity |
| P1A-09 | **Global search** (§16): name, mobile, Emirates ID, licence, plate, VIN, contract no., invoice no. — Postgres trigram index |
| P1A-10 | Customer/supplier detail pages with document tab and expiry status chips |

**Tests**
- Unit: expiry-offset calculation across 60/30/15/7, DST and leap-year boundaries
- Integration: uploading to any owner type; polymorphic query correctness; job run twice → still one
  notification per offset (the dedupe test)
- E2E: create customer → upload Emirates ID expiring in 29 days → notification appears → click
  through to customer
- QA negatives: expiry in the past, missing document number, 50MB upload, duplicate mobile number

---

### 6.2 Milestone 1B — Fleet (~1 wk) · SOW §4

| ID | Task |
|---|---|
| P1B-01 | `Vehicle` model: code, make, model, year, variant, colour, plate, VIN, mileage, ownership, supplier, source date, status |
| P1B-02 | **Vehicle status state machine** — 9 states, explicit transition table, illegal transitions throw |
| P1B-03 | Vehicle CRUD + list with §3 filters |
| P1B-04 | Ownership: Company Owned vs B2B/Supplier; supplier required when B2B (DB constraint, not just UI) |
| P1B-05 | Financial fields: purchase price / supplier monthly cost |
| P1B-06 | Photo gallery + vehicle documents (mulkiya, insurance) via the 1A engine |
| P1B-07 | Vehicle detail: overview, documents, contract history, status timeline |
| P1B-08 | Mileage log with monotonic-increase validation |

**Tests**
- Unit: every legal transition passes, every illegal one throws (full 9×9 matrix)
- Integration: B2B vehicle without supplier rejected at the DB layer; VIN and plate uniqueness
- QA negatives: duplicate VIN, mileage going backwards, Sold → Rented, deleting a vehicle on an
  active contract

---

### 6.3 Milestone 1C — Pricing Engine (~3 days) · SOW §8

| ID | Task |
|---|---|
| P1C-01 | **`calculateDeal()`** — pure, in `packages/core/pricing`, zero I/O |
| P1C-02 | Inputs: vehicle, supplier, supplier monthly cost, customer monthly rental, duration, down payment, annual insurance charge, insurance cost, expected maintenance, other costs |
| P1C-03 | Outputs: monthly revenue, monthly cost, monthly gross profit, total contract revenue, total cost, expected total profit, margin %, first-year revenue incl. insurance |
| P1C-04 | Deal Calculator UI — thin form over the pure function, live recalculation |
| P1C-05 | Save calculation as a quote, attach to a lead, convert to contract |

**Tests — the SOW's own numbers, pinned as assertions:**
- §8: supplier 2,400 · customer 3,500 · 36mo → **1,100/mo gross, 39,600 total** ✓
- Key Financial Logic table: supplier 2,300 · customer 3,400 · insurance 2,500/yr →
  **1,100/mo gross, 40,800 annual rental revenue, 43,300 first-year incl. insurance** ✓
- Edge: zero-cost vehicle, 1-month duration, cost above rental (negative margin must be *reported*,
  not clamped to zero), 120-month duration
- Property test: `totalProfit == (monthlyRevenue − monthlyCost) × months` for all valid inputs

> These two examples are the only externally-verifiable numbers in the entire SOW. They are our
> regression anchor for the whole financial engine — if a refactor breaks them, we broke the money.

---

### 6.4 Milestone 1D — Contracts, Payments & Insurance (~2 wks) · SOW §9, §10, §11

The highest-risk milestone. Everything financial converges here.

| ID | Task |
|---|---|
| P1D-01 | Contract CRUD: number, customer, vehicle, supplier, type, dates, duration, monthly rental, down payment, mileage allowance, excess mileage rate, payment day, terms |
| P1D-02 | **Contract status machine**: Draft → Pending → Active → Completed / Overdue / Cancelled |
| P1D-03 | **`ContractCharge` model** — composable charges (§3.4 of the plan), *not* fixed columns |
| P1D-04 | **Charge expansion → `Installment` generation** across the full duration, using largest-remainder allocation |
| P1D-05 | Invoice numbering: sequential, gapless, collision-safe under concurrency |
| P1D-06 | `Installment` model + status machine: Upcoming, Due, Partially Paid, Paid, Overdue, Waived |
| P1D-07 | `Payment` + `PaymentAllocation` — one payment settles across multiple installments |
| P1D-08 | Partial payment handling, over-payment → credit, waive with mandatory reason |
| P1D-09 | Nightly job: Upcoming → Due → Overdue transitions |
| P1D-10 | **`InsurancePolicy`** (§11): provider, policy no., type, charge amount, **cost amount** (open Q2), dates, document, status |
| P1D-11 | Insurance as its own recurring charge → own installments → `revenue.insurance` ledger category |
| P1D-12 | Insurance renewal alerts at 30/15/7 days |
| P1D-13 | `SupplierInvoice` — payable schedule mirroring the customer schedule, `cost.supplier` |
| P1D-14 | **`LedgerEntry` model + posting service.** Only domain events write here. Append-only enforced by DB trigger |
| P1D-15 | Wire every event to the ledger: contract activated, installment posted, payment received, supplier invoice raised, insurance charged |
| P1D-16 | Down payment posts to revenue on its charge date. There is no refundable deposit to track |
| P1D-17 | Contract detail: schedule, payment history, documents, ledger view |
| P1D-18 | Contract PDF generation |

**Tests** — all nine invariants (§2.3) go live here and run on every commit from now on.
- Unit: charge expansion for 12/24/36/60 months; annual insurance across a 36-month term → exactly 3
  charges; contract starting on the 31st; Feb 29 handling
- Integration: activate contract → correct installment count, exact fils total, correct ledger
  postings; partial payment → status and balance; over-payment → credit; concurrent invoice
  numbering under parallel inserts → no duplicates, no gaps
- Reconciliation: **INV-1 through INV-9**
- E2E: full money path — create contract → activate → record partial payment → record balance →
  installment shows Paid → dashboard revenue reflects it
- QA negatives: payment larger than balance, backdated payment, contract end before start, activating
  a contract on a Sold vehicle, deleting a customer with active contracts, two contracts on one
  vehicle for overlapping dates

**Exit:** a 36-month contract with annual insurance produces 36 rental installments + 3 insurance
installments, and the ledger reconciles to the contract total **to the fils**.

---

### 6.5 Milestone 1E — Dashboard & Reporting (~1 wk) · SOW §3, §14, §15

| ID | Task |
|---|---|
| P1E-01 | KPI service — every tile a ledger aggregate, never a stored field |
| P1E-02 | Dashboard tiles: total/owned/B2B/available/rented vehicles, active customers, active contracts, monthly revenue, monthly cost, monthly profit, customer outstanding, supplier payables, insurance renewals, expiring documents |
| P1E-03 | Alert panel: overdue payments, expiring Emirates IDs / licences / registration / insurance / contracts / maintenance |
| P1E-04 | Global filters: date range, vehicle, supplier, customer, salesperson, contract type — **Built 2026-09-19** on profitability: date range, view by vehicle/customer/supplier/contract/month, contract type and salesperson |
| P1E-05 | Profitability reports — by vehicle, customer, supplier, contract, month, year |
| P1E-06 | Revenue breakdown with **insurance separated from rental** (§11 requirement) |
| P1E-07 | Customer statement: paid, outstanding, full transaction history |
| P1E-08 | Supplier statement |
| P1E-09 | Excel export (SheetJS) on every report |
| P1E-10 | PDF export (React-PDF) on every report |
| P1E-11 | Query performance pass — indexes, materialised view for the dashboard if p95 > 500ms — **Measured 2026-09-19** (`pnpm bench:dashboard`): at 1,000 contracts (39k instalments) the worst p95 is 27 ms; at 5,000 (195k instalments, 60k ledger entries) it is 107 ms (profitability by contract). Well under 500 ms, so no materialised view |

**Tests**
- Reconciliation: **INV-6** — every KPI equals its ledger aggregate; every report cross-foots to the
  same underlying entries
- Integration: reports against the golden dataset match hand-calculated fixtures exactly
- Performance: dashboard p95 < 500ms at 10× the golden dataset
- QA: exports open cleanly in Excel and a PDF reader; totals in the export match the screen

---

### 6.6 Milestone 1F — Lead & Sales CRM (~3 days) · SOW §7

| ID | Task |
|---|---|
| P1F-01 | `Lead` model: name, phone, email, source, interested vehicle, budget, duration, salesperson, notes |
| P1F-02 | Pipeline: New → Contacted → Qualified → Deal Created → Contracted → Lost, with lost reason |
| P1F-03 | Kanban + list views |
| P1F-04 | Lead → deal calculation → contract conversion, preserving salesperson attribution |
| P1F-05 | Sales Staff role scoped to own leads (§2) |
| P1F-06 | Conversion funnel report — **Built 2026-09-19:** reached counts come from each lead's history, so the funnel only narrows |

**Tests**
- Integration: conversion carries attribution through to the contract; Sales Staff cannot read
  another salesperson's leads (the permission test that matters)
- E2E: lead → qualified → calculator → contract

**Phase 1 exit:** the full SOW flow — `Supplier → Vehicle → Customer → Contract → Payments → Profit`
— runs on real data. UAT with DrivenX staff. Zero open P0/P1.

---

## 7. Phase 2 — Operations (~4–5 wks) · SOW §12, §13

| ID | Task |
|---|---|
| P2-01 | `Handover` model: type (handover/return), date/time, mileage, fuel level, condition |
| P2-02 | Damage marking on a vehicle diagram, per-point photos |
| P2-03 | Signature capture — customer and staff |
| P2-04 | Handover / return PDF report |
| P2-05 | `MaintenanceRecord`: service date, mileage, garage/vendor, type, description, cost, invoice, next service date/mileage → `cost.maintenance` |
| P2-06 | Maintenance due alerts by date and mileage |
| P2-07 | `Fine`: number, date, amount, authority, payer, status, documents → `cost.fine`, and `revenue.fine_recovery` when recovered |
| P2-08 | Fine recovery flow — attach to the customer's next installment |
| P2-09 | `Accident`: date, location, description, photos, police report, insurance claim, repair cost, responsibility, status → `cost.repair` |
| P2-10 | Insurance claim tracking with recovery posting |
| P2-11 | `Expense` — categorised, allocatable to vehicle / contract / company overhead |
| P2-12 | **Final settlement on return**: excess mileage (settled here, per the client), damages, and any outstanding balance |
| P2-13 | Extended profitability — all Phase 2 cost categories flow into existing reports |
| P2-14 | Vehicle lifetime P&L view |

**Tests**
- Reconciliation: **INV-8** extended — a maintenance cost posted today changes vehicle profitability
  and monthly profit by exactly that amount, and by nothing else
- Integration: a return settlement posts excess mileage and damages as separate revenue lines, each
  net of VAT — never one lumped gross figure
- E2E: handover → maintenance → fine → return with settlement → final P&L
- QA negatives: return mileage below handover mileage, a settlement raised on a contract that is
  already closed, an accident on a vehicle with no active contract

**The real exit test:** vehicle profitability reflects maintenance, fines and repairs **with zero
changes to the 1E reporting layer.** If 1E needed edits, §3.2 of the plan was implemented wrong and
we fix it here, before Phase 3 builds on top.

---

## 8. Phase 3 — Automation & Integrations (~4–6 wks) · SOW §16, §18

Externally dependent. Sequence by when account access actually arrives, not by this order.

| ID | Task |
|---|---|
| P3-01 | Notification delivery abstraction: in-app → email → WhatsApp behind one interface |
| P3-02 | Email (transactional provider), templates, delivery log |
| P3-03 | **WhatsApp Business API** — *start template approval during Phase 2; lead time is weeks* |
| P3-04 | Automated reminder campaigns over the existing expiry engine |
| P3-05 | Payment gateway — online installment collection, webhook → payment + ledger |
| P3-06 | Payment reconciliation against gateway settlement reports |
| P3-07 | E-signature for contracts and handover forms |
| P3-08 | Accounting export / sync |
| P3-09 | Public REST API + OpenAPI, API key management, rate limiting (§18) |
| P3-10 | GPS / vehicle tracking — **feasibility spike first** |
| P3-11 | SMS fallback |
| P3-12 | UAE RTA services — **feasibility spike; API availability unverified in the SOW** |

**Tests**
- Integration: every external call mocked at the boundary; retry, timeout and idempotency paths
  explicitly tested
- **Webhook idempotency is a P0 concern** — a replayed payment webhook must never double-post to the
  ledger. Test with duplicate delivery, out-of-order delivery, and delivery after manual entry
- E2E against provider sandboxes

> P3-10 and P3-12 are marked "where APIs are available" in the SOW. Spike each for 1 day before
> committing to an estimate; report back rather than assuming.

---

## 9. Phase 4 — Hardening & Handover (~2 wks) · SOW §20

Contractual deliverables. Not optional, not compressible.

| ID | Task |
|---|---|
| P4-01 | Automated encrypted backups + **a restore actually performed and timed** |
| P4-02 | Security: rate limiting, upload validation, at-rest document encryption, dependency audit, session hardening, security headers |
| P4-03 | Penetration test pass on auth, RBAC, IDOR, file access |
| P4-04 | Load test at 3× projected fleet size |
| P4-05 | `docs/database.md` — schema, relationships, ERD |
| P4-06 | `docs/deployment.md` — runbook, env vars, migrations, rollback |
| P4-07 | `docs/architecture.md` — technical documentation |
| P4-08 | `docs/admin-manual.md` — end-user guide |
| P4-09 | Transfer source, DB, hosting, domain, API keys, Git repo to DrivenX ownership |
| P4-10 | **Audit for developer-personal dependencies — must be zero** |
| P4-11 | Admin credential handover |
| P4-12 | Staff training session + recording |

**P4-01 note:** a backup that has never been restored is not a backup. The deliverable is a
*completed restore*, with the elapsed time written down.

---

## 10. Target schema (Phase 0 + 1)

```prisma
// ---------- Identity & Access ----------
model User {
  id           String    @id @default(cuid())
  email        String    @unique
  passwordHash String
  fullName     String
  phone        String?
  isActive     Boolean   @default(true)
  lastLoginAt  DateTime?
  failedLogins Int       @default(0)
  lockedUntil  DateTime?
  roles        UserRole[]
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  deletedAt    DateTime?
}

model Role {
  id          String  @id @default(cuid())
  key         String  @unique          // super_admin, admin, sales, finance, operations
  name        String
  isSystem    Boolean @default(false)  // seeded defaults, still editable per §2
  permissions RolePermission[]
  users       UserRole[]
}

model Permission {
  id    String @id @default(cuid())
  key   String @unique                 // "contract.approve", "payment.waive"
  group String
  roles RolePermission[]
}

model RolePermission { roleId String; permissionId String; @@id([roleId, permissionId]) }
model UserRole       { userId String; roleId       String; @@id([userId, roleId]) }

model AuditLog {
  id         String   @id @default(cuid())
  actorId    String?
  entityType String
  entityId   String
  action     String                    // CREATE | UPDATE | DELETE | TRANSITION
  before     Json?
  after      Json?
  ipAddress  String?
  createdAt  DateTime @default(now())
  @@index([entityType, entityId])
  @@index([actorId, createdAt])
}

// ---------- Parties ----------
model Customer {
  id             String  @id @default(cuid())
  code           String  @unique
  fullName       String
  mobile         String
  email          String?
  dateOfBirth    DateTime?
  nationality    String?
  addressLine    String?
  emergencyName  String?
  emergencyPhone String?
  status         CustomerStatus @default(ACTIVE)
  contracts      Contract[]
  policies       InsurancePolicy[]
  payments       Payment[]
  // + audit fields
  @@index([mobile])
}

model Supplier {
  id             String  @id @default(cuid())
  code           String  @unique
  companyName    String
  contactPerson  String?
  phone          String?
  email          String?
  address        String?
  tradeLicenseNo String?
  trn            String?
  bankName       String?
  iban           String?
  notes          String?
  vehicles       Vehicle[]
  invoices       SupplierInvoice[]
}

// ---------- Documents (polymorphic — §3.3) ----------
enum DocumentOwnerType { CUSTOMER SUPPLIER VEHICLE CONTRACT INSURANCE_POLICY }

model DocumentCategory {
  id                     String   @id @default(cuid())
  key                    String   @unique   // emirates_id, driving_license, mulkiya, trade_license
  label                  String
  appliesTo              DocumentOwnerType[]
  requiresExpiry         Boolean  @default(true)
  defaultReminderOffsets Int[]    @default([60, 30, 15, 7])
}

model Document {
  id              String   @id @default(cuid())
  ownerType       DocumentOwnerType
  ownerId         String
  categoryId      String
  documentNumber  String?
  issueDate       DateTime?
  expiryDate      DateTime?
  fileKey         String
  fileName        String
  mimeType        String
  sizeBytes       Int
  status          DocumentStatus @default(VALID)
  reminderOffsets Int[]
  @@index([ownerType, ownerId])
  @@index([expiryDate])                     // drives the nightly scan
}

// ---------- Fleet ----------
enum OwnershipType { COMPANY_OWNED B2B_SUPPLIER }
enum VehicleStatus { AVAILABLE RESERVED RENTED LEASE_TO_OWN MAINTENANCE ACCIDENT RETURNED SOLD INACTIVE }

model Vehicle {
  id                      String  @id @default(cuid())
  code                    String  @unique
  make                    String
  model                   String
  year                    Int
  variant                 String?
  color                   String?
  plateNumber             String  @unique
  vin                     String  @unique
  currentMileage          Int     @default(0)
  ownershipType           OwnershipType
  supplierId              String?           // REQUIRED when B2B_SUPPLIER (check constraint)
  sourceDate              DateTime?
  purchasePriceFils       BigInt?
  supplierMonthlyCostFils BigInt?
  status                  VehicleStatus @default(AVAILABLE)
  contracts               Contract[]
  @@index([status, ownershipType])
}

// ---------- Contracts (composable charges — §3.4) ----------
enum ContractType   { LONG_TERM_RENTAL LEASE_TO_OWN B2B_RENTAL OTHER }
enum ContractStatus { DRAFT PENDING ACTIVE OVERDUE COMPLETED CANCELLED }
enum ChargeType     { MONTHLY_RENTAL ANNUAL_INSURANCE DOWN_PAYMENT ADMIN_FEE BUYOUT OTHER }
enum Recurrence     { ONCE MONTHLY ANNUAL }

model Contract {
  id                    String   @id @default(cuid())
  number                String   @unique
  customerId            String
  vehicleId             String
  supplierId            String?
  type                  ContractType
  startDate             DateTime
  endDate               DateTime
  durationMonths        Int
  monthlyRentalFils     BigInt
  downPaymentFils       BigInt   @default(0)   // Consideration, not refundable — posts revenue (INV-5)
  mileageAllowanceKm    Int?
  excessMileageRateFils BigInt?
  paymentDayOfMonth     Int      @default(1)
  terms                 String?
  status                ContractStatus @default(DRAFT)
  charges               ContractCharge[]
  installments          Installment[]
  policies              InsurancePolicy[]
  @@index([status, endDate])
}

model ContractCharge {
  id          String     @id @default(cuid())
  contractId  String
  chargeType  ChargeType
  label       String
  amountFils  BigInt
  recurrence  Recurrence
  startsOn    DateTime
  occurrences Int
  installments Installment[]
}

enum InstallmentStatus { UPCOMING DUE PARTIALLY_PAID PAID OVERDUE WAIVED }

model Installment {
  id            String   @id @default(cuid())
  contractId    String
  chargeId      String
  invoiceNumber String   @unique      // sequential, gapless (P1D-05)
  sequence      Int
  periodStart   DateTime
  periodEnd     DateTime
  dueDate       DateTime
  amountFils    BigInt
  paidFils      BigInt   @default(0)
  status        InstallmentStatus @default(UPCOMING)
  allocations   PaymentAllocation[]
  @@index([dueDate, status])
}

model Payment {
  id          String   @id @default(cuid())
  customerId  String
  receivedOn  DateTime
  amountFils  BigInt
  method      String
  reference   String?
  allocations PaymentAllocation[]      // Σ allocations == amountFils (INV-2)
}

model PaymentAllocation {
  id            String @id @default(cuid())
  paymentId     String
  installmentId String
  amountFils    BigInt
}

// ---------- Insurance (§11) ----------
model InsurancePolicy {
  id              String   @id @default(cuid())
  customerId      String
  vehicleId       String
  contractId      String?
  provider        String
  policyNumber    String
  insuranceType   String
  chargeAmountFils BigInt              // billed to customer  → revenue.insurance
  costAmountFils   BigInt?             // paid to provider    → cost.insurance  [OPEN Q2]
  startDate       DateTime
  expiryDate      DateTime
  status          String
  @@index([expiryDate])
}

model SupplierInvoice {
  id            String   @id @default(cuid())
  supplierId    String
  vehicleId     String?
  contractId    String?
  invoiceNumber String?
  periodStart   DateTime
  periodEnd     DateTime
  dueDate       DateTime
  amountFils    BigInt
  paidFils      BigInt   @default(0)
  status        String
}

// ---------- Ledger (§3.2 — the spine) ----------
enum LedgerDirection { REVENUE COST }

model LedgerEntry {
  id          String   @id @default(cuid())
  occurredOn  DateTime
  periodMonth Int                       // YYYYMM — indexed for every report
  direction   LedgerDirection
  category    String                    // revenue.rental | cost.maintenance | ...
  amountFils  BigInt
  vehicleId   String?                   // ── nullable dimensions ──
  contractId  String?
  customerId  String?
  supplierId  String?
  sourceType  String                    // what produced this entry
  sourceId    String
  reversesId  String?                   // corrections only — never UPDATE/DELETE (INV-7)
  memo        String?
  createdAt   DateTime @default(now())
  @@index([periodMonth, direction, category])
  @@index([vehicleId, periodMonth])
  @@index([contractId])
  @@index([supplierId, periodMonth])
}

// ---------- Leads (§7) ----------
enum LeadStatus { NEW CONTACTED QUALIFIED DEAL_CREATED CONTRACTED LOST }

model Lead {
  id                 String @id @default(cuid())
  name               String
  phone              String
  email              String?
  source             String?
  interestedVehicleId String?
  budgetFils         BigInt?
  durationMonths     Int?
  salespersonId      String?
  status             LeadStatus @default(NEW)
  lostReason         String?
  convertedContractId String?
}

// ---------- Notifications (§16) ----------
model Notification {
  id         String    @id @default(cuid())
  type       String
  severity   String
  title      String
  body       String
  entityType String
  entityId   String
  dueOn      DateTime?
  userId     String?
  readAt     DateTime?
  dedupeKey  String    @unique          // prevents duplicates on repeated job runs (P1A-07)
  createdAt  DateTime  @default(now())
}
```

Append-only enforcement on `LedgerEntry` is a Postgres trigger, not application convention —
application-level rules get bypassed eventually.

---

## 11. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| VAT requirement surfaces late (Open Q1) | Touches every invoice, installment, report | **Get the answer before 1D starts.** Non-negotiable |
| Rounding drift in installments | Silent, compounding, destroys trust in the books | INV-1 from day one; largest-remainder allocation in `Money` |
| Insurance cost side undefined (Open Q2) | Every profit number overstated | Schema field exists now; block 1E sign-off until answered |
| WhatsApp template approval delay | Blocks Phase 3 | Submit during Phase 2 |
| Ledger design proves wrong under Phase 2 | Expensive rework | Phase 2 exit test is exactly this — detected early by design |
| Scope creep during UAT | Timeline slip | UAT findings triage into P0–P3; new *features* go to a change list, not the sprint |
| Solo developer, no second pair of eyes | Bugs ship | Dedicated QA day per milestone; automated invariants as the safety net |
| **Audit rows are not transactionally atomic with the mutation** (P0-09) | A mutation outside a transaction can commit while its audit write fails, leaving a gap in a contractually required log (SOW §17). Raw SQL bypasses auditing entirely. | Accepted for Phase 0: the audit error propagates and rolls back any enclosing transaction. The complete fix is Postgres triggers with the actor passed via `SET LOCAL`, which also closes the raw-SQL bypass — scheduled into **P4-02**. |
| **A development image disappears from its registry** (happened in Phase 0) | Docker Hub stopped serving `minio/minio` and `minio/mc`. CI failed on every push from 4 September because a fresh runner could not pull them, while machines with a cached copy kept passing and hid it. | Replaced with RustFS, pinned to a version. Images are never `latest`. Bucket setup goes through the AWS SDK, so it no longer depends on any one server's command-line tool. The CI rehearsal pulls images fresh. After every push, the real Actions result is checked instead of inferred from local runs. |

---

## 12. Start here

`P0-01` — scaffold the monorepo. Then `P0-03` and `P0-05` in parallel: Docker up, and the `Money`
type with its allocation tests. Everything financial rests on `P0-05`, so it gets written first and
gets the harshest tests.
