# The DrivenX database

SOW §20 requires database documentation as a handover deliverable. This is it.

It does not list every column. `packages/db/prisma/schema.prisma` does that, it is the
authority, and it carries a comment on every field whose purpose is not obvious from its
name — which is why Prisma was chosen in the first place. What this explains is the
shape: why the tables are arranged as they are, which rules the database enforces on its
own, and what will break if somebody changes the wrong thing.

**PostgreSQL 16 · 41 tables · 39 enums · 19 migrations.**

---

## 1. The one idea the whole schema rests on

**Profit is never stored. It is always a `GROUP BY`.**

The obvious design puts money on the records that earn it: `vehicles.monthly_profit`,
`contracts.expected_profit`. That works until the first report that cuts the same dirham
a different way — and §14 asks for profit by vehicle *and* customer *and* supplier *and*
contract *and* month *and* year, with insurance reported separately but still counted.
Stored columns cannot answer all of those at once without disagreeing with each other.

So every dirham that moves becomes one immutable row in `ledger_entries`:

```
ledger_entries
  occurred_on, period_month
  direction        REVENUE | COST
  category         revenue.rental, cost.maintenance, … (see §4)
  amount_fils
  vehicle_id?  contract_id?  customer_id?  supplier_id?   ← nullable dimensions
  source_type, source_id                                  ← what produced it
  reverses_id?                                            ← corrections only
```

Every report in the system — the dashboard, profitability by any dimension, the customer
and supplier statements, a vehicle's lifetime P&L — is that one table grouped differently.
This is why Phase 2 could add maintenance, fines, accident repairs, insurance claims and
expenses without changing the reporting layer at all: each was a new `category`, and the
reports sum whatever they find.

Two consequences worth knowing before touching anything:

- **The ledger is append-only, enforced by a database trigger**
  (`ledger_entries_append_only`), not by convention. An `UPDATE` or `DELETE` raises an
  exception whatever issued it — application code, a migration, or somebody at a psql
  prompt. Mistakes are corrected with a reversing entry carrying a negative amount and a
  `reverses_id`; the `ledger_amount_sign` constraint is what allows negatives only there.
- **Nothing writes to it directly.** Domain events do: a contract activated, a payment
  received, an instalment issued, a fine paid, a claim settled. If you find yourself
  inserting a ledger row from a screen, the event it belongs to has not been modelled.

## 2. Money

**Every amount is a `BigInt` of fils.** One dirham is 100 fils. There is no `Float` and no
`Decimal` anywhere in the schema or the application, because both lose money in ways that
only show up after a few thousand instalments.

Rounding happens exactly once, when a total is split into instalments, using
largest-remainder allocation so the parts always sum back to the whole. That rule lives in
`packages/core/money` and is the most heavily tested code in the repository.

**VAT is stored as three columns, never two.** Anywhere an amount can carry tax you will
find `net_fils`, `vat_fils` and `gross_fils`, with a CHECK constraint asserting
`gross = net + vat` — on instalments, supplier invoices, expenses, settlement lines and
accident repairs. The net is the business figure and the only one that reaches the ledger;
VAT collected belongs to the FTA and is never revenue, and VAT paid on a supplier's bill is
reclaimed and is never a cost. Getting this wrong overstates every profit report by about
five per cent, which is why it is a database constraint rather than a code convention.

Two exceptions, both deliberate:

- **Traffic fines** carry a single `amount_fils`. A penalty is not a supply, so there is no
  input VAT on it to reclaim, and a net/VAT split would invent 5% nobody paid.
- **Expenses** carry a per-row `vat_basis_points`, defaulting to zero for government
  charges — registration, Salik, public parking — and 5% for ordinary supplies.

## 3. The spine

```
users ─┬─ user_roles ── roles ── role_permissions ── permissions
       └─ audit_logs

customers ─┬─ documents (polymorphic)
           ├─ contracts
           └─ leads

suppliers ─┬─ documents
           ├─ vehicles            (ownership_type = B2B_SUPPLIER)
           └─ supplier_invoices ── supplier_payments

vehicles ──┬─ documents           (mulkiya, photos)
           ├─ mileage_readings, vehicle_status_changes
           ├─ insurance_policies ── insurance_claims
           ├─ maintenance_records, fines, accidents, expenses
           └─ ledger_entries      (dimension)

contracts ─┬─ contract_charges ── installments ── payment_allocations ── payments
           ├─ handovers ── damage_points
           ├─ settlements ── settlement_lines
           ├─ documents           (signed contract PDF)
           └─ ledger_entries      (dimension)

notifications ── notification_deliveries
```

### Contracts compose charges; they do not hardcode them

A contract does not have a "monthly rental" column that the schedule is derived from.
It owns a list of `contract_charges` — monthly rental, annual insurance, down payment,
admin fee, buyout, fine recovery — each with an amount, a recurrence and a start date.
Activation expands those into `installments`.

This is the mechanism that makes long-term rental, lease-to-own, B2B and eventually
brokerage the same engine: they differ only in which charges they compose. Adding a new
kind of charge is a new enum value and a row in the category map, not a new contract type
with its own scheduling code.

### One document engine, not eight

`documents` is polymorphic on `owner_type` / `owner_id`, covering customers, suppliers,
vehicles, contracts, insurance policies, maintenance records, handover forms, damage
points and accidents. An Emirates ID, a trade licence, a mulkiya, a signed contract and a
photograph of a scratch are all rows in one table, and one nightly job scans `expiry_date`
across all of them.

The cost of that choice: **there is no foreign key on the owner.** The database cannot
stop a document pointing at a deleted customer. Deletions go through the application,
which removes documents with their owner, and `(owner_type, owner_id)` is indexed so an
orphan check is cheap. If you add a new owner type, add it to the `DocumentOwnerType` enum
*and* to `ownerExists()` in the web app — the exhaustive `Record` on `OWNER_PATH` will
fail the build if you forget the second half.

## 4. Ledger categories

Revenue: `rental`, `insurance`, `excess_mileage`, `fine_recovery`, `insurance_claim`,
`salvage`, `other`.

Cost: `supplier`, `insurance`, `maintenance`, `repair`, `registration`, `fine`, `fuel`,
`toll`, `cleaning`, `parking`, `recovery`, `overhead`, `other`.

The category is a string rather than a database enum, on purpose: extending the system
should mean adding a category, not running a migration. The price is that nothing stops a
typo, so the list that is *meant* to exist lives in `packages/core/src/ledger/categories.ts`,
the reports iterate it, and a test checks the message catalogues against it. A category
with no label still prints, as its raw key — a report that silently dropped money it could
not name would stop adding up with nothing to say why.

Two distinctions that look like duplicates and are not:

- `revenue.insurance` is the premium **charged to a customer**, which §11 requires to be
  reportable on its own. `revenue.insurance_claim` is money **an insurer paid** after a
  crash. Mixing them inflates precisely the figure the SOW asks to see separately.
- `cost.insurance` is what DrivenX pays the insurer. `cost.repair` is what a garage
  charged after an accident, which may be partly recovered by a claim and partly not — the
  part that is not is the policy excess, and it stays a cost.

## 5. What the database enforces on its own

Roughly forty CHECK constraints and four partial unique indexes. They exist because the
application is not the only thing that can write to this database — a migration, a script,
a future API, or somebody at a prompt can too, and the rules below are the ones where being
wrong is either money or evidence.

**Money**

| Constraint | Rule |
|---|---|
| `installments_gross_is_net_plus_vat` | and the same on supplier invoices, expenses, settlement lines, accident repairs |
| `installments_paid_within_amount` | never negative, never more than the instalment |
| `ledger_amount_sign` | amounts are positive unless the row is a reversal |
| `payments_credit_within_amount` | a credit cannot exceed the payment that created it |
| `expenses_allocation_has_its_dimensions` | a company overhead carries no vehicle and no contract |

That last one is worth dwelling on. An overhead filed against a car is invisible once it
is in the ledger, and every per-vehicle figure after it is quietly wrong with nothing to
show why. The constraint is the only thing that makes that impossible rather than merely
discouraged.

**Evidence**

| Constraint | Rule |
|---|---|
| `handovers_signed_has_both_signatures` | a signed form has both, or it is not signed |
| `handovers_customer_signature_complete` | a signature is a file, a name and a time — all three or none |
| `damage_points_position_complete` | a mark is on the diagram with both coordinates, or off it with neither |
| `fines_paid_has_a_date` | a fine that is a cost carries the day it became one |
| `claims_settled_has_money_and_a_date` | settled means money arrived, on a day |
| `deliveries_sent_has_a_time` | a delivery that claims to have been sent says when |

**Uniqueness that respects soft deletes**

Four unique indexes are partial, because a plain one would hold a slot for ever against a
row somebody removed:

- `contracts_one_live_contract_per_vehicle` — a car is on at most one live contract (INV-9)
- `handovers_one_per_contract_and_type` — one handover and one return per contract
- `fines_one_per_authority_and_number` — the same notice cannot be entered twice
- `claims_one_per_policy_and_number`

**Human-facing numbers** — customer, supplier, vehicle, contract and lead codes come from
Postgres sequences, not from `COUNT(*) + 1`. Two people creating a record at the same
moment cannot be handed the same number. Tax invoice numbers are sequential and gapless,
which the FTA expects.

## 6. Soft deletes and audit

Almost every table carries `created_at`, `updated_at` and `deleted_at`. **Deleting through
the application sets `deleted_at`; it does not remove the row.** Every query in the data
layer filters `deletedAt: null`, and forgetting that filter is the single easiest mistake
to make in this codebase — a report that includes deleted records will look plausible and
be wrong.

`audit_logs` records every mutation with the actor and a before/after diff, written
automatically by a Prisma extension rather than by each call site. Two known limits, both
scheduled for the Phase 4 security pass (P4-02):

- Raw SQL bypasses it entirely.
- The audit write is not transactionally atomic with the mutation in every path. The
  intended fix is Postgres triggers with the actor passed through `SET LOCAL`, which also
  closes the raw-SQL gap.

## 7. Working with migrations

```bash
pnpm db:migrate          # create and apply a migration in development
pnpm db:migrate:deploy   # apply pending migrations (this is what production runs)
pnpm db:migrate:test     # apply them to the test database
pnpm db:generate         # regenerate the Prisma client after a schema change
pnpm db:seed             # seeded roles, permissions and document categories
pnpm db:seed:golden      # the deterministic dataset the tests assert against
```

Migrations are **forward-only**. A constraint that needs to change is dropped explicitly
and re-added in the same migration — see `20260920110000_supplier_input_vat`, which renames
`amount_fils` to `net_fils` and rebuilds the two constraints that referenced it. There is
no `down` migration; rolling back means restoring a backup, which is why P4-01 requires a
*tested* restore rather than a backup script.

Prisma cannot express partial unique indexes, CHECK constraints or triggers. Those are
written by hand at the end of the migration that needs them, and the schema file carries a
comment at the model saying so. **If you regenerate a migration from the schema alone, you
will lose them** — check the diff before committing.

## 8. If you change one thing, check these

- **A new ledger category** — add it to `packages/core/src/ledger/categories.ts` and give
  it a label in both message catalogues. A test will fail if you do not.
- **A new notification type** — add it to `NOTIFICATION_TYPES`, give it a visibility
  permission in `packages/auth/src/notifications.ts`, and an email template in both
  languages. Three tests cover this.
- **A new document owner type** — the enum, `ownerExists()`, and `OWNER_PATH`.
- **A new charge type** — the enum, the revenue category map in `contracts.ts`, and a
  label. Otherwise it renders as a raw key in the middle of a payment schedule, which has
  happened once.
- **Anything touching money** — run `pnpm test:reconciliation` *and* `pnpm test:integration`.
  Twelve financial invariants (INV-1 to INV-12) are asserted between them: the
  reconciliation suite carries the ones that must hold across the whole golden dataset
  (INV-1 instalments sum to the contract, INV-3 nothing is overpaid, INV-4 VAT is never
  revenue, INV-9 one live contract per vehicle), and the rest are asserted beside the code
  they constrain — INV-6 that every report cross-foots to the same ledger, INV-11 and
  INV-12 on supplier payables.
