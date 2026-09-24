# Using DrivenX

A guide for the people who run the business on it. No technical knowledge assumed.

If something here does not match what you see on screen, it is probably because your role
does not include it — see "Who can see what" below.

---

## Signing in

Your Super Admin creates your account and gives you a password to change. Five wrong
passwords locks the account for a while; ask an administrator to unlock it rather than
waiting.

The language switch is at the bottom of the sidebar. It is per person, not per computer —
choose Arabic and it stays Arabic wherever you sign in, and the whole interface mirrors
right to left, including printed contracts.

## Who can see what

Five roles ship with the system, and a Super Admin can change what any of them includes at
any time, without waiting for a developer.

| Role | Sees |
|---|---|
| **Super Admin** | Everything, including users and roles |
| **Admin / Management** | Customers, vehicles, suppliers, contracts, payments, reports. Not users or roles |
| **Sales Staff** | Leads, the deal calculator, customer details and documents — **only their own leads** |
| **Accounts / Finance** | Payments, receivables, supplier payments, expenses, financial reports |
| **Operations** | Vehicles, maintenance, insurance, accidents, fines, handover and return |

A change to a role takes effect immediately. Nobody has to sign out and back in.

## The daily rhythm

The dashboard is the first screen and it is meant to be the only one you need in the
morning. It shows what is overdue, what expires soon, and what the month has earned and
cost so far. Every tile links to the list behind it.

Overnight the system also:

- looks for documents and insurance policies running out, and raises an alert at 60, 30,
  15 and 7 days before
- moves instalments from Upcoming to Due to Overdue
- checks which cars are near a service, by date or by distance
- sends one email to each person covering everything waiting for them

That last one is deliberately a single email rather than one per alert. Everything in it is
also in the notifications list, and marking something read there clears it for everybody —
the list is a shared work queue, not a personal inbox.

You can turn your own emails off on the notifications screen. You cannot turn off the
in-app alerts, because they are the record that something was noticed at all.

---

## Customers, suppliers and their documents

Add a customer with at least a name and a mobile number; everything else can follow. The
customer number is allocated automatically and is never reused.

Upload documents — Emirates ID, licence, passport, visa, trade licence — with their expiry
date. **The expiry date is the entire point.** A document without one is stored but never
chased, and chasing is why the system holds documents at all.

A Super Admin can add new document types under Administration without a developer.

## The fleet

A vehicle needs a make, model, year, plate and chassis number. Two things are enforced:

- A car marked **B2B / Supplier** must name its supplier. The system refuses to save one
  without.
- **The odometer never goes backwards.** A reading lower than the last is refused, because
  excess mileage at the end of a contract is settled against it.

A car's status — Available, Reserved, Rented, Lease-to-Own, Maintenance, Accident,
Returned, Sold, Inactive — mostly changes on its own as contracts start and end. Where you
can change it by hand, the system offers only the moves that make sense from where it is.

**A car leased in from a supplier goes out on lease-to-own only.** Never a plain rental,
and never sold except as the end of that lease-to-own. This is enforced, not just
discouraged.

## Quoting and contracts

The **deal calculator** prices a deal before it exists: supplier cost, customer rental,
duration, insurance, and it shows the monthly profit, the total over the term and the
margin. The same calculation runs behind contracts and reports, so a quote and the contract
it becomes cannot disagree.

A contract is drafted, then **activated**. Activation is the moment that matters: it
generates the whole payment schedule to the last month, moves the car, and starts the
books. Before activation you can change anything; after it, the schedule exists and
corrections are made by recording payments, waiving instalments or settling.

Amounts are entered **before VAT**. The system adds 5% and invoices the total, because VAT
collected belongs to the FTA and is not income — if it were counted as revenue, every
profit figure would be about 5% too high.

**Payments** can be partial. Record what was received and it is applied to the oldest
amount owed first. Overpayment becomes a credit. Waiving an instalment requires a reason,
and the reason is kept.

**Ending a contract** opens a settlement: arrears are shown as they stand and are never
re-charged, and you add what is new — excess mileage, damage, fees — or take something off.
Settling raises one final invoice, numbered like any other.

## Handover and return

Fill the form beside the car with the customer present.

Record the odometer and the fuel, then **mark the damage on the diagram by clicking the
car where it is**. The panel is taken from where you click — so "front left door" six
months later means the front left door, not whatever somebody wrote down. Damage that a
view from above cannot show — interior, wheels, mechanical — is chosen from the list
instead. Each mark can be photographed.

Then both of you sign, on screen. **Signing freezes the form**: the readings become
evidence and can no longer be changed, and the odometer becomes the car's official mileage.
Until it is signed it is a draft you can correct or throw away.

When the car comes back you do the same again, and the system works out the extra
kilometres against the contract's allowance and offers the charge for the settlement. It
will not offer a figure until both forms are signed, because a reading nobody agreed to is
not one to charge anybody for.

## Keeping cars on the road

**Maintenance** — record the garage, the odometer and the bill, and when the next service
is due by date or distance. The car appears in the alerts when it gets close to either.

**Fines** — record the notice with the date **of the offence**, not the day it arrived. That
date decides who was driving, and notices arrive weeks late. The system works out whether
the car was out with a customer that day.

Then say what happened: DrivenX paid it, the customer paid it directly, it is being
disputed, or it was cancelled. **Nothing reaches the accounts until money actually moves** —
a fine the customer settles with the authority never touches DrivenX's books at all. Once
DrivenX has paid, you can recharge the customer, which raises a real invoice on their
contract, or absorb it.

**Accidents** — record where and what happened; fault defaults to "not yet known" because
the police report decides that and it takes weeks. Add the repair bill when it arrives, and
lodge an insurance claim against the policy.

A claim being **approved is not the same as being paid**, and the system keeps them apart.
Only money that actually arrives comes off the cost. What is left — the excess, and anything
the insurer disallowed — stays as a cost of running that car, which is what the profit
figures should show.

**Expenses** — registration, fuel, Salik, cleaning, parking, recovery, and the office costs
that belong to no car. Charge each to a car, to a contract, or to the company. Company costs
deliberately cannot be charged to a car: office rent is not one vehicle's cost, and letting
it be filed against one would quietly distort that car's profitability for ever.

Government charges default to no VAT, because there is none on them to reclaim. A private
car park does charge VAT, and you can say so.

## What the reports answer

**Profitability** — by vehicle, customer, supplier, contract or month, over any range, and
filterable by contract type and salesperson. Insurance is reported separately from rental
but still counted in the total. Below it, a breakdown of where the money actually went by
category.

**A car's lifetime** — on each vehicle's page: everything it has earned and cost since
DrivenX took it on. This is the one that answers "was this car worth owning", which no
single month can settle: a car can lose money through every month of a repair and still
have paid for itself twice over. A loss shows as a loss.

**Statements** — per customer and per supplier: paid, outstanding, full history.

Every report exports to Excel and PDF, and the totals in the export match the screen.

Every figure comes from the same underlying record of money, so two reports cannot disagree
with each other. If one ever seems to, that is a fault worth reporting rather than working
around.

## Printing

Contracts print in English or Arabic — `?lang=ar` on the contract PDF gives the Arabic
version to an English reader and the reverse, because the person printing is not always the
person signing.

Handover and return reports print the same way, with the diagram, the numbered damage list
and both signatures embedded in the page rather than linked, so the document stands on its
own once it leaves the system.

## Administration

Under Administration a Super Admin can add users, assign roles, edit exactly what each role
can do, add document types, and read the audit log — which records every change, who made
it, and what it was before.

Two habits worth keeping:

- Give people the narrowest role that lets them work. It is a minute's work to widen it.
- When somebody leaves, deactivate the account rather than deleting it. Their history stays
  attached to what they did, and a deactivated account stops receiving alerts immediately.
