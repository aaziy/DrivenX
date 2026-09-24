# DrivenX — Build Plan

Internal working document. Source of truth for sequencing and architecture decisions.
Derived from `DrivenX_Software_Scope_of_Work.pdf` (4 pages, 20 sections).

**Status:** Phase 0 and Phase 1 shipped; Phase 2 in progress · **Last updated:** 2026-09-24

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
| Auth | Self-managed signed session cookie over our own argon2 login (replaced the planned Auth.js in P0-11) | Permissions resolve per request, which a token carrying roles cannot do; no auth vendor to hand over |
| File storage | S3-compatible behind an interface | RustFS locally and in CI, pinned (replaced MinIO when its images left Docker Hub); swap the endpoint for prod, no code change |
| Background jobs | Postgres-backed queue + cron worker | No Redis dependency until we actually need one |
| Money | `BigInt` fils (1 AED = 100 fils) | Never floats. See §3.1 |
| VAT | 5%, added to a net price; stored net, invoiced gross (decided 2026-09-17) | VAT collected belongs to the FTA, so it never reaches a revenue category. Booking it as income would overstate every profit report by roughly 5% |
| Deployment | Hostinger VPS (KVM 2), Docker Compose (decided 2026-09-17) | No UAE data-residency requirement, so a plain VPS running our own stack is the cheapest thing DrivenX can fully own |

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
                   revenue.fine_recovery | revenue.insurance_claim | revenue.salvage
                   revenue.other
                   cost.supplier | cost.insurance | cost.maintenance | cost.repair
                   cost.registration | cost.fine | cost.fuel | cost.toll | cost.cleaning
                   cost.parking | cost.recovery | cost.overhead | cost.other
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
  contract_id, charge_type      -- monthly_rental | annual_insurance | down_payment
                                -- admin_fee | buyout | other
                                -- excess mileage is settled at return, not scheduled here
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
└─ docker-compose.yml       postgres + s3 (RustFS) + web + worker
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

**Deliberate call:** there is no refundable deposit to model. The client takes a **down payment** on
some contracts and does not return it (answered 2026-09-17), so it is consideration like any other
charge: it posts to `revenue.*` on its charge date. The liability that *does* exist is **VAT
collected** — 5% sits on top of every net price, belongs to the FTA, and never touches `revenue.*`.
Getting that one wrong overstates profit on every single contract.

---

## 6. Phases

Estimates assume **one full-time developer**. Scale accordingly.

### Phase 0 — Foundations · ~1 week
*Nothing here is visible to the client. All of it is load-bearing.*

- [x] Monorepo, TypeScript config, lint, format, CI
- [x] `docker-compose.yml`: Postgres + MinIO
- [x] Prisma init, `Money` type + allocation tests, base model conventions
- [x] Auth.js credentials login, session, password policy, lockout
- [x] RBAC: permission catalogue, `can()` helper, six seeded roles (§2)
- [x] Audit log: automatic before/after capture on every mutation (§17)
- [x] Storage interface + MinIO adapter, virus-scan hook stub
- [x] App shell: layout, nav, table primitive, form primitive, toast
- [x] Seed script with realistic UAE test data

**Done when:** a Super Admin can log in, create an Operations user, edit that role's permissions,
see the change take effect immediately, and find both actions in the audit log.

---

### Phase 1 — Core · ~5–7 weeks
*Maps to SOW §19 "Phase 1 — Core". Ships in five internal milestones.*

#### 1A · Parties & Documents (~1 wk) — §6, §5, §16
- [x] Customer CRUD: customer no., name, mobile, email, DOB, nationality, address, emergency contact
- [x] Supplier CRUD: company, contact, trade licence, TRN/VAT, bank details, agreements, notes
- [x] Polymorphic document upload with number / issue / expiry / file / status
- [x] Configurable document categories (§17)
- [x] Nightly expiry scan → notifications at 60/30/15/7 days
- [x] Global search across name, mobile, Emirates ID, licence (§16)

**Done when:** an Emirates ID expiring in 29 days produces exactly one notification, and the
dashboard alert links straight to the customer.

#### 1B · Fleet (~1 wk) — §4
- [x] Vehicle CRUD: make, model, year, variant, colour, plate, VIN/chassis, mileage
- [x] Ownership type: Company Owned | B2B/Supplier, with supplier link and source date
- [x] Status state machine: Available, Reserved, Rented, Lease-to-Own, Maintenance, Accident,
      Returned, Sold, Inactive
- [x] Photos and vehicle documents via the 1A engine
- [x] Fleet list with the §3 filters

**Done when:** a B2B vehicle cannot be saved without a supplier, and status transitions are enforced.

#### 1C · Pricing engine (~3 days) — §8
- [x] Pure `calculateDeal()` in `packages/core/pricing`
- [x] Outputs: monthly revenue, monthly vehicle cost, monthly gross profit, total contract revenue,
      total cost, expected total profit, margin %
- [x] Test suite pinned to **both** SOW worked examples (§3.5 above)
- [x] Deal Calculator UI — a thin form over the pure function

**Done when:** the two SOW examples pass as automated tests, not as a manual check.

#### 1D · Contracts, Payments & Insurance (~2 wks) — §9, §10, §11
- [x] Contract CRUD: number, customer, vehicle, supplier, type, dates, duration, monthly rental,
      down payment, mileage allowance, excess mileage rate, payment day, terms
- [x] Types: Long-Term Rental, Lease-to-Own, B2B Rental, Other
- [x] Status machine: Draft → Pending → Active → Completed / Overdue / Cancelled
- [x] Charge composition → automatic installment generation across the full duration
- [x] Installments: invoice no., due date, amount, paid, balance, method, reference
- [x] Statuses: Upcoming, Due, Partially Paid, Paid, Overdue, Waived
- [x] Partial payments with correct allocation across installments
- [x] Annual insurance as its own recurring charge + policy record + renewal alerts (30/15/7)
- [x] Supplier payable schedule mirroring the customer schedule
- [x] **Every one of the above posts to the ledger**

**Done when:** activating a 36-month contract with annual insurance generates 36 rental installments
plus 3 insurance installments, and the ledger balances against the contract total to the fils.

#### 1E · Dashboard & Reporting (~1 wk) — §3, §14, §15
- [x] KPI tiles: total / owned / B2B / available / rented vehicles, active customers, active
      contracts, monthly revenue, monthly cost, monthly profit, customer outstanding, supplier
      payables, insurance renewals, expiring documents
- [x] Alert panel: overdue payments, expiring IDs / licences / registration / insurance / contracts
- [x] Filters: date, vehicle, supplier, customer, salesperson, contract type
- [x] Profitability reports by vehicle · customer · supplier · contract · month · year
- [x] Customer statement and supplier statement (paid / outstanding / history)
- [x] Excel + PDF export on every report (§15)

**Done when:** the monthly profit KPI equals the sum of ledger entries for that period, verified by
an automated reconciliation test.

#### 1F · Lead & Sales CRM (~3 days) — §7
> **Scope note:** §7 is not assigned to any phase in the SOW's own §19 phasing. We place it here
> because it feeds the Deal Calculator and because the Sales Staff role (§2) has nothing to operate
> without it. Flag this to the client.

- [x] Lead CRUD: name, phone, email, source, interested vehicle, budget, duration, salesperson, notes
- [x] Pipeline: New → Contacted → Qualified → Deal Created → Contracted → Lost
- [x] Convert lead → deal calculation → contract, preserving attribution

**Phase 1 exit criteria:** DrivenX can run the entire core business flow end to end —
`Supplier → Vehicle → Customer → Contract → Payments → Profit` — on real data, with no spreadsheets.

---

### Phase 2 — Operations · ~4–5 weeks
*Maps to SOW §19 "Phase 2".*

- [x] **Handover & Return (§12):** date/time, mileage, fuel, condition, damage marking, photos,
      customer + staff signatures, PDF report generation
- [x] **Maintenance (§13):** service date, mileage, garage/vendor, type, description, cost, invoice,
      next service date/mileage → posts `cost.maintenance`
- [x] **Fines (§13):** fine number, date, amount, authority, payer, status, documents → posts
      `cost.fine` and, when recovered, `revenue.fine_recovery`
- [x] **Accidents (§13):** location, description, photos, police report, insurance claim, repair
      cost, responsibility, status → posts `cost.repair`
- [x] **Advanced expenses:** categorised, allocatable to vehicle / contract / company overhead
- [x] **Final settlement on return:** excess mileage (settled here), damages, outstanding balance
- [~] **PDF generation** for contracts, invoices, statements, handover and return reports — contracts, statements and handover/return ship; a tax invoice has no page of its own yet, and its layout waits on open question 13 (TRN, FTA numbering)
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
| 2 | Operations **Answered 2026-09-20:** the cost is whatever the insurer invoices for that car, entered on the policy from their invoice. | 4–5 wks |
| 3 | Automation & integrations **Answered 2026-09-20:** early termination is settled case by case — a settlement opens with the arrears already on it and staff add or waive lines. No fixed penalty formula. | 4–6 wks |
| 4 | Hardening & handover | 2 wks |
| | **Total** | **16–21 wks** for one full-time developer |

Phase 3 has the widest variance because it depends on third-party approvals outside our control.

---

## 8. Open questions for the client

Answer before the dependent phase starts.

| # | Question | Blocks | Why it matters |
|---|---|---|---|
| 1 | **VAT.** **Answered 2026-09-17: 5% applies, added on top of the base price, and the invoiced total is VAT-inclusive.** Contract amounts are therefore stored net, VAT is derived from them, and the customer is billed the gross figure. VAT collected is a liability owed to the FTA, never revenue. | 1D | Settled. The SOW's worked examples stay valid because its figures are net: 3,400 net + 170 VAT = 3,570 charged, margin still 1,100. |
| 2 | **Insurance cost vs charge.** **Partly answered 2026-09-17:** the premium depends on the car, so insurance is priced per vehicle rather than at one flat rate. **Still open:** what DrivenX pays the insurer for a given car. | 1D | The policy record carries both a charge and a cost. While the cost is blank, insurance reports as 100% margin and profit is overstated. |
| 3 | **Lease-to-own terms.** **Answered 2026-09-17:** ownership transfers at the end of the term against a final payment of AED 1,000. **Still open:** early termination or default, and whether VAT applies to that final payment. | 1D | A one-off `BUYOUT` charge at the end of the schedule. Early termination is a real gap: a customer who stops paying at month 20 of 36 currently has no defined outcome. |
| 4 | **Security deposit.** **Answered 2026-09-17: there are none.** A down payment is sometimes taken at the start instead. It is not refunded, so it is revenue on its charge date rather than a liability — the opposite of what this plan assumed. | 1D | Corrected in §3.4 and §5. `SECURITY_DEPOSIT` becomes `DOWN_PAYMENT`, and INV-5 changes with it. |
| 5 | **Excess mileage.** **Answered 2026-09-17: settled when the car comes back.** | 2 | Not a recurring contract charge. It is a line in the final settlement at return, beside damages and any outstanding balance. |
| 6 | **Fines.** Default payer — customer or company? Is recovery automatic on the next installment? **Answered 2026-09-24 in part:** fines are entered by hand; the RTA has no API to pull them from, so P3-12 is not waited on. **Built on two assumptions the client should confirm:** the fine falls to whoever had the car on the *offence* date (and to DrivenX when it was in the yard), and recovery is never automatic — staff recharge it explicitly, which raises one invoice. **Still open:** whether recharging a fine carries VAT. It is currently treated as a disbursement and recharged at cost; if their accountant calls it a taxable supply, it becomes the contract's ordinary rate and nothing else changes. | 2 | §13 has a `payer` field but no policy. |
| 7 | **Arabic / RTL.** **Answered 2026-09-16:** English and Arabic, switchable per person, Arabic mirrored right-to-left. Built and shipped. Arabic contracts and invoices still to confirm. | 0 / 1D | **Risk:** the Arabic text is an unreviewed draft — the client accepted it for now (2026-09-17), but financial and legal wording needs a fluent reviewer before real customers see it. PDF generation in 1D must support Arabic script. |
| 8 | **Data migration.** **Answered 2026-09-17: nothing to import.** | 1 | No import tooling, and no separate estimate for it. Customers, suppliers and vehicles are entered as they arrive. |
| 9 | **Payment methods.** Cash, bank transfer, cheque, card? Any bank reconciliation or cheque-tracking requirement? **Answered 2026-09-20:** bank transfer, cash, card, Tamara and Tabby. Cheques are not used, so no post-dated cheque tracking and no bank reconciliation. | 1D | §10 says "payment method" with no enumeration. Post-dated cheques are common in UAE leasing and would need their own tracking. |
| 10 | **Concurrent users & fleet size** at launch and at 2-year projection. | 0 | Sets the infrastructure sizing decision we deferred. |
| 11 | **Hosting decision.** **Answered 2026-09-17: data need not stay in the UAE.** Target is a Hostinger VPS (KVM 2) running the same Docker stack as development; Hostinger Business shared hosting was ruled out (no PostgreSQL, no storage server, no background jobs). **Remaining:** account created in DrivenX's name (§20), and who maintains the server after handover. | 0 | Staging and client testing wait on the account existing. |
| 12 | **Input VAT on supplier invoices.** Is the 5% DrivenX pays its suppliers recoverable? If so, vehicle cost and profit must use the net figure rather than the gross. **Answered 2026-09-20: yes, recoverable.** The monthly cost entered for a leased car is net; the supplier invoice adds 5%, the ledger costs the net amount, and the VAT is tracked apart from profit. | 1D | Raised 2026-09-17 by the VAT answer. Assuming either way puts profit out by about 5% of cost. Supplier invoices (P1D-13) store the vehicle's monthly cost exactly as entered and cost it in full, so for now enter that figure the way profit should count it. |
| 13 | **Tax invoice details.** DrivenX's TRN, and the invoice numbering the FTA expects on a tax invoice. | 1D | Affects the invoice layout, not the calculations. |
| 14 | **Cars leased in from a supplier.** **Answered 2026-09-18:** a B2B car goes to a customer only on lease-to-own — never on a plain rental, and never sold except as the end of that lease-to-own (the buyout). | 1B / 1D | Enforced in the vehicle state machine, not only on screen: for a leased-in car, Available/Reserved → Rented and Available/Accident/Inactive → Sold are refused; Lease-to-own → Sold stays open. Contracts in 1D will offer only lease-to-own for these cars, and the deal calculator prices them as lease-to-own. |

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
