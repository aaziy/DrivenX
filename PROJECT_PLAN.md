# DrivenX — Build Plan

Internal working document. Source of truth for sequencing and architecture decisions.
Derived from `DrivenX_Software_Scope_of_Work.pdf` (4 pages, 20 sections).

**Status:** Planning · **Last updated:** 2026-09-02

---

## 0. How to use this document

- Section 3 (Architecture Principles) is **non-negotiable**. Those decisions are expensive to reverse.
- Section 6 (Phases) is the work queue. Build strictly top to bottom.
- Section 8 (Open Questions) must be answered by the client before the phase that depends on it ships.
- Section 9 maps every SOW section to a phase — use it to prove scope coverage at handover.

---

## 1. The one thing that matters

The SOW's closing developer note is the real spec:

> The database architecture and financial calculation engine are critical. The system should be
> designed so DrivenX can later support normal rental, long-term rental, lease-to-own, B2B fleet
> management and vehicle brokerage without rebuilding the core system.

Everything else in the document is CRUD around that sentence. So we build the **core spine first**
— identity, parties, fleet, contracts, money — and hang features off it. We do not build screens
first.

### The failure mode we are explicitly designing against

The obvious implementation stores profit as columns: `vehicles.monthly_profit`,
`contracts.expected_profit`. It works for the first demo, then dies the moment you hit:

- §14 — profit by vehicle **and** customer **and** supplier **and** contract **and** month **and** year
- §11 — insurance revenue reported **separately** from rental revenue, but included in profitability
- §13 — maintenance and repair expenses must **feed into** vehicle profitability
- The note above — brokerage has no monthly rental at all, so the columns are meaningless

**Our answer: a ledger-first core.** Every dirham of revenue and cost is an immutable line item
tagged with vehicle, contract, customer, supplier, category and period. Profit is a `GROUP BY`, never
a stored field. Adding brokerage later = adding two ledger categories, not a migration of the core.

---

## 2. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Stack | Next.js (App Router) + TypeScript | One repo, one language, server components suit an internal admin tool |
| Database | PostgreSQL 16 | Partial indexes, `jsonb`, generated columns, real transactions |
| ORM / migrations | Prisma | Schema file doubles as the DB documentation required by §20 |
| Tenancy | Single company | DrivenX only. Retrofit path kept open (see §3.8) |
| Auth | Auth.js (credentials) + server-side session | No third-party identity vendor to hand over |
| File storage | S3-compatible behind an interface | MinIO locally; swap the endpoint for prod, no code change |
| Background jobs | Postgres-backed queue + cron worker | No Redis dependency until we actually need one |
| Money | `BigInt` fils (1 AED = 100 fils) | Never floats. See §3.1 |
| Deployment | **Deferred** — Docker Compose is the dev target | Decide before Phase 0 closes |

---

## 3. Architecture principles

### 3.1 Money is an integer, always
All amounts stored as `BigInt` in **fils**. No `Float`, no `Decimal` in application code. One
`Money` type in `packages/core` with `add`, `subtract`, `multiply`, `allocate`, `format`. Rounding
happens exactly once, at the point of allocation, using largest-remainder so split installments
always sum back to the total.

### 3.2 The ledger is the single source of financial truth

```
ledger_entries
  id, occurred_on, period_month
  direction        revenue | cost
  category         revenue.rental | revenue.insurance | revenue.excess_mileage
                   revenue.fine_recovery | revenue.salvage | revenue.other
                   cost.supplier | cost.insurance | cost.maintenance | cost.repair
                   cost.registration | cost.fine | cost.other
  amount_fils
  vehicle_id?  contract_id?  customer_id?  supplier_id?     -- nullable dimensions
  source_type, source_id                                    -- what produced this
  reverses_id?                                              -- corrections only
```

Rules:
- **Append-only.** Mistakes are fixed with a reversing entry, never an `UPDATE` or `DELETE`.
- Nothing writes to it directly. Domain events do: contract activated, payment received, invoice
  posted, maintenance logged, fine recorded.
- Every report in §14 and §15 is a query over this one table with different `GROUP BY` dimensions.

### 3.3 One document engine, not eight
§6, §11, §13, §16 and §17 all describe the same shape. Build it once:

```
documents
  owner_type, owner_id            -- customer | supplier | vehicle | contract | insurance_policy
  category_id                     -- configurable per §17
  document_number, issue_date, expiry_date
  file_key, mime, size, status
  reminder_offsets int[]          -- default {60,30,15,7} per §6
```

A single nightly job scans `expiry_date` across the whole table and emits notifications. Emirates ID,
driving licence, passport, visa, trade licence, mulkiya, insurance policy and contract PDFs are all
just rows. Adding a new document type later is a config change, not a code change.

### 3.4 Contracts compose charges; they don't hardcode them
§11 requires insurance to be a **separate recurring customer charge**, not a column on the contract.
So the contract owns a list of charge definitions:

```
contract_charges
  contract_id, charge_type      -- monthly_rental | annual_insurance | security_deposit
                                -- admin_fee | excess_mileage | buyout | other
  amount_fils, recurrence       -- once | monthly | annual
  starts_on, occurrences
```

The scheduler expands these into `installments`. Long-term rental, lease-to-own, B2B and brokerage
differ only in which charges they compose — the engine is identical. This is the mechanism that
delivers the developer note's promise.

### 3.5 The pricing engine is a pure function
The Deal Calculator (§8) is **not** a screen with arithmetic in it. It's a tested pure function in
`packages/core/pricing` taking inputs and returning the full breakdown. The same function serves the
sales quote screen, the contract preview, and the projected-profit report. One implementation, one
set of tests, no drift.

Verified against both SOW worked examples:
- §8: supplier 2,400 · customer 3,500 · 36mo → 1,100/mo gross · 39,600 total gross ✓
- Key Financial Logic table: supplier 2,300 · customer 3,400 · insurance 2,500/yr →
  1,100/mo gross · 40,800 annual rental revenue · 43,300 first-year revenue incl. insurance ✓

### 3.6 Status fields are state machines
Vehicle (§4), contract (§9), payment (§10) and lead (§7) statuses each get an explicit transition
table. Illegal transitions throw. Every transition writes an audit row. This prevents the classic
"vehicle is Rented but has no active contract" data corruption.

### 3.7 Permissions are data, not code
§2 requires role permissions to be configurable by the Super Admin at runtime. So:
`permissions` (seeded catalogue) → `role_permissions` (editable) → `user_roles`. Checks are
`can(user, 'contract.approve')`, never `if (user.role === 'admin')`. The six SOW roles ship as seeded
defaults the client can then edit.

### 3.8 Retrofit hooks we keep open
Not building these now, but not closing the door either:
- Every table carries `created_by`, `created_at`, `updated_at`, `deleted_at` (soft delete)
- All data access goes through repository functions — adding a `company_id` scope later is one layer
- Domain logic lives in `packages/core` with zero Next.js imports, so an API surface (§18) can be
  added without touching it

---

## 4. Repository layout

```
drivenx/
├─ apps/
│  ├─ web/                  Next.js App Router — UI + route handlers
│  └─ worker/               cron: expiry scans, installment generation, notifications
├─ packages/
│  ├─ core/                 domain layer, zero framework imports
│  │  ├─ money/             Money type, allocation, formatting
│  │  ├─ pricing/           deal calculator (pure)
│  │  ├─ contracts/         charge expansion, state machine
│  │  ├─ ledger/            entry builders, aggregation queries
│  │  └─ documents/         expiry rules
│  ├─ db/                   Prisma schema, migrations, seed
│  ├─ auth/                 session, RBAC, permission catalogue
│  ├─ storage/              S3-compatible document storage, upload validation
│  └─ ui/                   shared components, tables, forms
├─ docs/                    §20 handover documentation (written as we go, not at the end)
└─ docker-compose.yml       postgres + minio + web + worker
```

---

## 5. Core data model (Phase 1 scope)

```
users ─┬─ user_roles ── roles ── role_permissions ── permissions
       └─ audit_logs

customers ─┬─ documents (polymorphic)
           ├─ contracts
           └─ insurance_policies

suppliers ─┬─ documents
           ├─ vehicles           (ownership_type = b2b)
           └─ supplier_invoices

vehicles ──┬─ documents          (mulkiya, photos)
           ├─ contracts
           └─ ledger_entries     (dimension)

contracts ─┬─ contract_charges ── installments ── payment_allocations ── payments
           ├─ insurance_policies
           ├─ documents          (signed contract PDF)
           └─ ledger_entries     (dimension)

leads ───── converts to ──► contracts
```

**Deliberate call:** `security_deposit` is modelled as a **liability**, not revenue. It never posts
to `revenue.*`. On return it either refunds or converts to `revenue.other` net of deductions.
Getting this wrong overstates profit on every single contract.

---

## 6. Phases

Estimates assume **one full-time developer**. Scale accordingly.

### Phase 0 — Foundations · ~1 week
*Nothing here is visible to the client. All of it is load-bearing.*

- [ ] Monorepo, TypeScript config, lint, format, CI
- [ ] `docker-compose.yml`: Postgres + MinIO
- [ ] Prisma init, `Money` type + allocation tests, base model conventions
- [ ] Auth.js credentials login, session, password policy, lockout
- [ ] RBAC: permission catalogue, `can()` helper, six seeded roles (§2)
- [ ] Audit log: automatic before/after capture on every mutation (§17)
- [ ] Storage interface + MinIO adapter, virus-scan hook stub
- [ ] App shell: layout, nav, table primitive, form primitive, toast
- [ ] Seed script with realistic UAE test data

**Done when:** a Super Admin can log in, create an Operations user, edit that role's permissions,
see the change take effect immediately, and find both actions in the audit log.

---

### Phase 1 — Core · ~5–7 weeks
*Maps to SOW §19 "Phase 1 — Core". Ships in five internal milestones.*

#### 1A · Parties & Documents (~1 wk) — §6, §5, §16
- [ ] Customer CRUD: customer no., name, mobile, email, DOB, nationality, address, emergency contact
- [ ] Supplier CRUD: company, contact, trade licence, TRN/VAT, bank details, agreements, notes
- [ ] Polymorphic document upload with number / issue / expiry / file / status
- [ ] Configurable document categories (§17)
- [ ] Nightly expiry scan → notifications at 60/30/15/7 days
- [ ] Global search across name, mobile, Emirates ID, licence (§16)

**Done when:** an Emirates ID expiring in 29 days produces exactly one notification, and the
dashboard alert links straight to the customer.

#### 1B · Fleet (~1 wk) — §4
- [ ] Vehicle CRUD: make, model, year, variant, colour, plate, VIN/chassis, mileage
- [ ] Ownership type: Company Owned | B2B/Supplier, with supplier link and source date
- [ ] Status state machine: Available, Reserved, Rented, Lease-to-Own, Maintenance, Accident,
      Returned, Sold, Inactive
- [ ] Photos and vehicle documents via the 1A engine
- [ ] Fleet list with the §3 filters

**Done when:** a B2B vehicle cannot be saved without a supplier, and status transitions are enforced.

#### 1C · Pricing engine (~3 days) — §8
- [ ] Pure `calculateDeal()` in `packages/core/pricing`
- [ ] Outputs: monthly revenue, monthly vehicle cost, monthly gross profit, total contract revenue,
      total cost, expected total profit, margin %
- [ ] Test suite pinned to **both** SOW worked examples (§3.5 above)
- [ ] Deal Calculator UI — a thin form over the pure function

**Done when:** the two SOW examples pass as automated tests, not as a manual check.

#### 1D · Contracts, Payments & Insurance (~2 wks) — §9, §10, §11
- [ ] Contract CRUD: number, customer, vehicle, supplier, type, dates, duration, monthly rental,
      deposit, mileage allowance, excess mileage rate, payment day, terms
- [ ] Types: Long-Term Rental, Lease-to-Own, B2B Rental, Other
- [ ] Status machine: Draft → Pending → Active → Completed / Overdue / Cancelled
- [ ] Charge composition → automatic installment generation across the full duration
- [ ] Installments: invoice no., due date, amount, paid, balance, method, reference
- [ ] Statuses: Upcoming, Due, Partially Paid, Paid, Overdue, Waived
- [ ] Partial payments with correct allocation across installments
- [ ] Annual insurance as its own recurring charge + policy record + renewal alerts (30/15/7)
- [ ] Supplier payable schedule mirroring the customer schedule
- [ ] **Every one of the above posts to the ledger**

**Done when:** activating a 36-month contract with annual insurance generates 36 rental installments
plus 3 insurance installments, and the ledger balances against the contract total to the fils.

#### 1E · Dashboard & Reporting (~1 wk) — §3, §14, §15
- [ ] KPI tiles: total / owned / B2B / available / rented vehicles, active customers, active
      contracts, monthly revenue, monthly cost, monthly profit, customer outstanding, supplier
      payables, insurance renewals, expiring documents
- [ ] Alert panel: overdue payments, expiring IDs / licences / registration / insurance / contracts
- [ ] Filters: date, vehicle, supplier, customer, salesperson, contract type
- [ ] Profitability reports by vehicle · customer · supplier · contract · month · year
- [ ] Customer statement and supplier statement (paid / outstanding / history)
- [ ] Excel + PDF export on every report (§15)

**Done when:** the monthly profit KPI equals the sum of ledger entries for that period, verified by
an automated reconciliation test.

#### 1F · Lead & Sales CRM (~3 days) — §7
> **Scope note:** §7 is not assigned to any phase in the SOW's own §19 phasing. We place it here
> because it feeds the Deal Calculator and because the Sales Staff role (§2) has nothing to operate
> without it. Flag this to the client.

- [ ] Lead CRUD: name, phone, email, source, interested vehicle, budget, duration, salesperson, notes
- [ ] Pipeline: New → Contacted → Qualified → Deal Created → Contracted → Lost
- [ ] Convert lead → deal calculation → contract, preserving attribution

**Phase 1 exit criteria:** DrivenX can run the entire core business flow end to end —
`Supplier → Vehicle → Customer → Contract → Payments → Profit` — on real data, with no spreadsheets.

---

### Phase 2 — Operations · ~4–5 weeks
*Maps to SOW §19 "Phase 2".*

- [ ] **Handover & Return (§12):** date/time, mileage, fuel, condition, damage marking, photos,
      customer + staff signatures, PDF report generation
- [ ] **Maintenance (§13):** service date, mileage, garage/vendor, type, description, cost, invoice,
      next service date/mileage → posts `cost.maintenance`
- [ ] **Fines (§13):** fine number, date, amount, authority, payer, status, documents → posts
      `cost.fine` and, when recovered, `revenue.fine_recovery`
- [ ] **Accidents (§13):** location, description, photos, police report, insurance claim, repair
      cost, responsibility, status → posts `cost.repair`
- [ ] **Advanced expenses:** categorised, allocatable to vehicle / contract / company overhead
- [ ] **Final settlement on return:** excess mileage, damages, outstanding, deposit resolution
- [ ] **PDF generation** for contracts, invoices, statements, handover and return reports
- [ ] Advanced reporting and drill-down across all new cost categories

**Done when:** vehicle-level profitability reflects maintenance, fines and accident repairs without
any change to the reporting layer built in 1E. *(That's the test of whether §3.2 was done right.)*

---

### Phase 3 — Automation & Integrations · ~4–6 weeks
*Maps to SOW §19 "Phase 3". Every item is externally dependent — sequence by which account access
arrives, not by this order.*

- [ ] Notification delivery layer: in-app → email → WhatsApp, one interface (§16)
- [ ] WhatsApp Business API (template approval is a multi-week lead time — start it during Phase 2)
- [ ] Payment gateway for online installment collection
- [ ] E-signature for contracts and handover forms
- [ ] Automated reminder campaigns on the Phase 1 expiry engine
- [ ] Accounting software export/sync
- [ ] Public REST API + OpenAPI docs (§18)
- [ ] GPS / vehicle tracking, SMS, UAE RTA services *where APIs exist* (§18 — availability unverified)

---

### Phase 4 — Hardening & Handover · ~2 weeks
*Maps to SOW §20. Non-optional — this is a contractual deliverable.*

- [ ] Automated encrypted backups + a **tested restore procedure**
- [ ] Security pass: rate limiting, file upload validation, at-rest encryption for documents,
      dependency audit, session hardening
- [ ] Load test at 3× projected fleet size
- [ ] `docs/`: database documentation, deployment runbook, admin manual, technical architecture
- [ ] Transfer of source, database, hosting, domain, API keys, Git repository to DrivenX ownership
- [ ] **Verify zero dependencies on developer-personal accounts or credentials**
- [ ] Admin credential handover + staff training session

---

## 7. Timeline summary

| Phase | Scope | Estimate |
|---|---|---|
| 0 | Foundations | 1 wk |
| 1 | Core (1A–1F) | 5–7 wks |
| 2 | Operations | 4–5 wks |
| 3 | Automation & integrations | 4–6 wks |
| 4 | Hardening & handover | 2 wks |
| | **Total** | **16–21 wks** for one full-time developer |

Phase 3 has the widest variance because it depends on third-party approvals outside our control.

---

## 8. Open questions for the client

Answer before the dependent phase starts.

| # | Question | Blocks | Why it matters |
|---|---|---|---|
| 1 | **VAT.** Is 5% UAE VAT charged on rentals? Do invoices need TRN, tax-invoice numbering and a VAT return report? | 1D | §5 mentions TRN only for suppliers. VAT is invasive to retrofit — it touches every invoice, installment and report. Highest-priority question. |
| 2 | **Insurance cost vs charge.** §11 stores what the customer is charged; §14 requires "insurance cost" as a cost line. Do we record what DrivenX pays the provider separately? | 1D | Without it, insurance shows as 100% margin and every profit number is wrong. |
| 3 | **Lease-to-own terms.** Does ownership transfer at term end? Is there a buyout / balloon amount? What happens on early termination or default? | 1D | LTO is a named contract type with zero defined mechanics in the SOW. |
| 4 | **Security deposit.** Refundable liability (our assumption) or recognised as revenue? Partial forfeiture rules on damage? | 1D | See §5. Affects every profit figure. |
| 5 | **Excess mileage.** Charged monthly on overage, or reconciled once at return? | 1D / 2 |Determines whether it's a recurring charge or a settlement line. |
| 6 | **Fines.** Default payer — customer or company? Is recovery automatic on the next installment? | 2 | §13 has a `payer` field but no policy. |
| 7 | **Arabic / RTL.** Required for the UI, for generated PDFs, or not at all? | 0 | Cheap to build in at Phase 0, expensive to add at Phase 3. |
| 8 | **Data migration.** Are there existing spreadsheets or a system to import vehicles, customers and live contracts? | 1 | Import tooling is unscoped work that must be estimated separately. |
| 9 | **Payment methods.** Cash, bank transfer, cheque, card? Any bank reconciliation or cheque-tracking requirement? | 1D | §10 says "payment method" with no enumeration. Post-dated cheques are common in UAE leasing and would need their own tracking. |
| 10 | **Concurrent users & fleet size** at launch and at 2-year projection. | 0 | Sets the infrastructure sizing decision we deferred. |
| 11 | **Hosting decision** — VPS, managed cloud, or AWS? Data residency requirement? | 0 | Deferred by choice; must close before Phase 0 ends. |

---

## 9. SOW coverage map

| SOW § | Topic | Phase |
|---|---|---|
| 1 | Project objective | — |
| 2 | User roles | 0 |
| 3 | Dashboard | 1E |
| 4 | Vehicle / fleet management | 1B |
| 5 | Supplier / B2B partner management | 1A |
| 6 | Customer management & documents | 1A |
| 7 | Lead & sales CRM | 1F *(unphased in SOW — see note)* |
| 8 | Deal calculator | 1C |
| 9 | Contract management | 1D |
| 10 | Payment management | 1D |
| 11 | Annual customer insurance | 1D |
| 12 | Vehicle handover & return | 2 |
| 13 | Maintenance, fines & accidents | 2 |
| 14 | Profit & financial reporting | 1E *(extended in 2)* |
| 15 | Reports & exports | 1E |
| 16 | Notifications & search | 1A + 1E *(delivery channels in 3)* |
| 17 | Admin, security & audit | 0 |
| 18 | Future integrations | 3 |
| 19 | Development phases | this document |
| 20 | Ownership & handover | 4 |

Every SOW section is assigned. No gaps.

---

## 10. Next action

Phase 0, task 1: scaffold the monorepo and stand up Postgres + MinIO in Docker.
