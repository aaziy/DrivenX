# What the build needs from outside it

Everything below is blocked on a person rather than on code. Each item says what it
blocks, what has been assumed in the meantime, and what changes if the answer differs.

Nothing here is urgent in the sense of stopping work today — Phase 4's documentation and
security pass can proceed without any of it. It is urgent in the sense that several items
have long lead times, and one of them has already slipped.

**Last updated:** 2026-09-24 · Phases 0–2 complete, Phase 3 started (3 of 12).

---

## 1. Start this week, whatever else happens

### WhatsApp Business API template approval

**Blocks:** P3-03, and the reminder delivery the client asked for in §16.
**Lead time:** weeks. Meta reviews each message template by hand.
**Status:** not started. The plan said to begin it during Phase 2; Phase 2 is finished.

This is the only item whose delay cannot be recovered by working faster later. The code
side is done — the delivery layer built in P3-01 takes WhatsApp as one more adapter — so
the approval is the whole of the remaining work.

What is needed: a Meta Business account, a phone number that is not already on WhatsApp,
and the message templates submitted for review. The templates are short and I can draft
them from the notification types that already exist; somebody with access to the Meta
account has to submit them.

### An SMTP mailbox

**Blocks:** nothing — email works today and writes to the log instead of sending.
**Effort:** ten minutes.

This is the cheapest win available. Any provider works, because delivery goes over SMTP
rather than one vendor's API. Put the values in `.env` (it is gitignored and has never
been committed) and email starts going out on the next worker run:

```
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM="DrivenX <alerts@drivenx.ae>"
APP_URL=https://the-real-address
```

**Do not paste credentials into chat.** Put them in `.env` and say only which provider
you chose, so it can be noted in the deployment runbook.

---

## 2. Answers only DrivenX can give

These are questions about how the business actually works. Each has a working assumption
already built, so nothing is stalled — but an assumption that turns out wrong is rework,
and two of these touch money.

| # | Question | Assumed meanwhile | If the answer differs |
|---|---|---|---|
| Q6 | **Who does a traffic fine fall to by default?** | Whoever had the car on the day of the offence; DrivenX when it was in the yard. | A settings change, not rework. |
| Q6 | **Is fine recovery automatic on the next instalment?** | No — staff recharge explicitly, which raises one invoice. | Rework of the recovery flow if it must be automatic. |
| Q6 | **Does recharging a fine carry VAT?** Treated as a disbursement (paid on the customer's behalf) rather than a supply by DrivenX. | No VAT: recharged at exactly what the authority charged. | One rate to change. **Needs their accountant, not their operations staff.** |
| Q3 | **Does VAT apply to the AED 1,000 lease-to-own buyout?** | The contract's standard rate. | One rate to change. Same accountant. |
| Q13 | **DrivenX's TRN, and the invoice numbering the FTA expects on a tax invoice.** | Sequential `INV-000001`, gapless. | Blocks the tax invoice PDF, which is the one item in Phase 2 still marked partial. |
| Q10 | **How many staff at once, and how many cars — at launch and in two years?** | Benchmarked at 5,000 contracts; comfortable. | Sets the server size and the Phase 4 load test target. |

## 3. Decisions about the handover itself

| # | Item | Why it matters |
|---|---|---|
| Q11 | **A Hostinger VPS in DrivenX's name.** | §20 requires DrivenX to own the hosting outright. Until the account exists there is nowhere to put a staging environment, and staff cannot test against real data. |
| Q11 | **Who maintains the server after handover?** | Decides how much of Phase 4 is automation and how much is a runbook for a human. |
| Q7 | **A fluent Arabic reader to review the financial and legal wording.** | The Arabic is an unreviewed draft that the client accepted provisionally. It is now on printed contracts and handover reports that customers sign. This is the item most likely to embarrass somebody. |

## 4. Accounts for the rest of Phase 3

None of these block anything today; each unblocks one task when it arrives. Sequence them
by whichever is easiest to obtain — the plan is explicit that Phase 3 should be ordered by
when access actually arrives, not by the order it lists.

| Task | What is needed | Notes |
|---|---|---|
| P3-05/06 Payment gateway | A merchant account and sandbox credentials | Telr, Network International, Checkout.com and Stripe are the common UAE options. The webhook must be idempotent — a replayed payment must never post twice — which is built and tested the moment there is a sandbox to test against. |
| P3-07 E-signature | A provider account | Applies to contracts and to the handover forms, which already capture a drawn signature locally. |
| P3-08 Accounting export | **Which package DrivenX uses** — this is a question, not an account | Zoho Books, QuickBooks, Tally and Xero all export differently. Knowing the name is enough to start. |
| P3-10 GPS tracking | Whether any vehicles have trackers, and whose | The SOW says "where APIs are available". A one-day feasibility check answers it. |
| P3-12 RTA services | Nothing yet | The SOW does not claim an API exists. Treat as a spike, and expect the answer to be that fines and registration stay manual — which is what the client has been doing anyway. |

---

## How to get any of this to me

- **Answers and decisions:** say them in plain words. No format needed.
- **Credentials:** `.env` only. It is gitignored, untracked, and has never been in a
  commit. Tell me the provider name so the runbook can record it; never the secret.
- **Accounts:** tell me it exists and which provider. I will ask for the specific
  environment variables that provider needs.
- **The Arabic review:** send the reviewer the printed contract and the handover report,
  which are the two documents a customer actually signs.
