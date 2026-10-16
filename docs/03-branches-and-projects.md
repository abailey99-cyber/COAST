# Branches and Projects (product owner, 15 October 2026)

Additional design alongside the build specification, not a replacement.
Built as **Phase 7b (Branches)** and **Phase 7c (Projects)** after the pilot
readiness plan (`docs/04-pilot-readiness-plan.md`). Every principle of the
main specification still applies. Adjustments agreed against what's already
built are in `docs/00-decisions-and-conflicts.md` section N (N5–N9).

**Naming:** "customer sites" are a customer's delivery addresses. The
business's own selling locations are **Branches**, in code and UI.

## Branches

A branch is a selling location only. It decides which internal sales staff
can see an order. It isn't a warehouse or dispatch point and is never shown
to customers.

**Decided**
- Each sales order belongs to exactly one branch.
- Sales reps are restricted to their own branch by default. An admin can widen this per person, or switch the restriction off for the whole business.
- Within their branch, a rep sees colleagues' orders read-only.
- Admin, Procurement and Director see every branch, with a branch filter on every list, dashboard and report. Director stays read-only. (N6: delivered as a permission, "See every branch", that those roles hold by default.)

**Data model**

| Table / field | Purpose |
|---|---|
| `branches` | organisation, name, short code, address, active, `is_default` (exactly one per organisation) |
| `sales_orders.branch_id` | required; the selling branch |
| `staff_users.home_branch_id` | required for sales reps, optional otherwise |
| `user_branch_access` | extra branches granted: user, branch, granted by, granted at |
| `restrict_sales_to_branch` (organisation setting) | default true |
| `erp_branch_mappings` | ERP location/subsidiary/department value → branch, for the order sync |

Customers and suppliers stay organisation-wide. Only orders are
branch-scoped; lines, POs, shipments, tracking, chases, customs, problems and
messages inherit from their order.

**Visibility for a restricted rep** — they see an order if its branch is
their home branch, or one they've been granted, or the order is assigned to
them. With the restriction off, reps see every order read-only, as before.
Edit rights don't change either way. A rep with no home branch sees only
orders assigned to them; admin screens flag such people.

**Admin controls** — Team: home branch, grant/revoke branches. Company
settings: the restriction switch and the Branches list (add, rename,
deactivate, choose default). Every access change audited.

**Day to day** — a new order defaults to the creator's home branch;
procurement and admin can choose any. Moving an order between branches is
admin/procurement only and a logged order event. ERP orders take their
branch from `erp_branch_mappings`; unmapped values land in the default branch
and are flagged in the review queue, never guessed. Goods-in isn't
branch-scoped. **Single-branch businesses never see any of this**: selectors,
filters and admin appear only once a second active branch exists.

**Retrofit sequence (7b)**, each step merged and green before the next;
nothing changes for existing users until step 4:
1. Additive migration: tables and setting; one default branch per organisation; `branch_id` nullable → backfill → required; backfill reps' home branch.
2. Security rules: helpers like `current_user_can_see_branch(branch_id)` and `current_user_can_see_order(order_id)`; apply to sales orders; check every child table resolves through its order. Isolation tests first.
3. Elevated-access audit: list every service-role query (jobs, reports, counts, feed, notifications, search) and either run it as the user or add an explicit branch filter with its own test. Commit the list as a checklist.
4. UI: branch admin, home branch and grants in Team, branch filter on Orders, Chases, Home and reporting, a branch column on Orders, branch-aware tiles — all hidden with one branch.

The "can this user see this order" decision is a pure, unit-tested function;
the database rule mirrors it.

## Projects

A project groups sales orders that belong to the same piece of work.
Linking is optional, at order level, and always a deliberate decision by the
salesperson. A project can involve more than one customer, so it carries the
strongest safeguards here.

**Decided** — nothing links automatically; one order belongs to at most one
project; a project can have several participating customers; customers see
projects in their portal, get a project tracking link, and can group their
own orders into their own projects.

**Data model**

| Table / field | Purpose |
|---|---|
| `projects` | organisation, name, internal reference, status (open/closed), optional target date, created by/at, closed by/at |
| `project_customers` | project, customer, that customer's project reference, status (pending/active/removed), added by/at, approved by/at |
| `sales_orders.project_id` | optional link |
| `customer_project_groups` (+ members) | groups a customer makes in their portal; separate from projects |

The database enforces that an order can only join a project its own customer
is an active participant in: composite foreign key `sales_orders(project_id,
customer_id)` → `project_customers(project_id, customer_id)` plus a trigger
that rejects the link unless that participant is active.

**Staff workflow** — create a project from a customer's page or from an order
("Add to project → New project"); the first customer is the order's. Link an
order (the picker lists only open projects where this customer is active).
Bulk link from Orders, each checked individually, failures listed with the
reason. Unlink or move: an order event. Close: suggested when every line is
delivered and no problem is open; a person confirms; closed accepts no new
orders; reopening is logged.

**Project page** — orders grouped by customer with stage and status; "14 of 20
lines delivered"; predicted completion = latest predicted date across open
lines; at risk if any order is, with the cause listed; open problems and
chases; a project-scoped updates feed; the POs behind it so procurement can
chase everything from one screen.

**Elsewhere** — Orders filter and search by project name or a customer's
project reference; reporting per project (spend, on-time, problem rate); ERP
orders arrive unlinked, any suggested match goes to the review queue.

### Multi-customer safeguards

A shared project must never reveal one customer's data to another —
"structurally impossible, not just careful", like supplier masking.

1. Adding a further customer takes two people: requested by anyone who can create projects, pending until approved by an Admin or Procurement user who isn't the requester. No order for that customer links while pending. (N8: a business with only one admin/procurement user can self-approve, audited as such.)
2. Confirm the actual company: add and approve screens show legal name, account code and primary delivery address; customers are picked from a list, never typed.
3. The database refuses wrong links (composite key + trigger).
4. A participant can't be removed while any of their orders are linked (database-enforced). Removing one revokes their project links immediately.
5. Every request, approval, rejection and removal is audited.

**What each customer sees** — only their own orders on a shared project:
never another participant's orders, lines, addresses, prices or contacts,
and by default not that another company is involved. Built like supplier
masking: a separate customer-safe project type from exactly one function
taking the project and the viewing customer; no field for other
participants. Progress and predicted completion from their own orders only.
The staff-reply leak guard also blocks other participants' names and order
numbers on that project.

**Project tracking links** — always scoped to one project *and* one customer;
revocable, expiring, rate-limited like other no-login routes; messages and
notifications only to the viewing customer's own contacts.

**Customer-created groups** — owned by the customer (N9: per COAST account,
since accounts are people who follow orders across businesses), never by the
business; only orders the customer can already see; never shared. In the
portal both kinds show under Projects, labelled "Set up by [business]" or
"Created by you"; customers manage only their own. Staff see a customer's
groups read-only on the customer's page. Built only from masked data.

### Branches × projects

Projects aren't branch-scoped. A restricted rep can open a project if they can
see at least one of its orders; other branches' orders appear only as a count
("3 further orders at other branches"); rollups are labelled "for the orders
you can see" when some are hidden. The picker offers only projects they can
open and orders they can see. Admin, Procurement and Director see everything
with the branch filter. Customers never see branches.

## Tests required (database-level, as real users, plus pure-function tests)

**Branches** — a Branch A rep can't read any Branch B order or its lines, POs, shipments, tracking, chases, problems or messages; a granted rep can, and revoking removes access at once; assigned orders always visible; restriction off → all branches read-only, still no edit; Admin/Procurement/Director see all, Director can't write; no home branch → assigned only; every elevated-access query tested for branch filtering; after the backfill every order has a branch and nobody's visible orders change until the UI step.

**Projects** — linking to a project where the customer isn't an active participant is rejected by the database; pending blocks linking; requester can't self-approve (except N8); a participant with linked orders can't be removed; the customer-safe function for Customer A returns nothing from Customer B (names, counts, totals); a (project, Customer A) link never returns B's orders and removing A revokes it; a reply to A naming B's name or order number is blocked; a customer group can't contain another company's order and is invisible to everyone else; a restricted rep sees only a count for hidden orders, with labelled rollups.

## Build order (7c)
1. Schema, composite key and trigger, database tests.
2. Staff workflow and project page, single customer only.
3. Multi-customer participants with two-person approval.
4. Customer-safe project type, portal project view, project tracking links.
5. Customer-created project groups.
6. Project reporting and the project filter on Orders.

## Still to decide (defaults to build against)
- [x] Managers — answered by the existing Sales manager role (E7) plus all-branch access by default (N5).
- [ ] Customer-message fallback when the rep is away. Default: the existing organisation-wide fallback (procurement, C5).
- [ ] Participant names on shared projects. Default: never shown to customers.
- [ ] Turning a customer group into a staff project. Default: not in this build.
- [ ] Who can create projects. Default: any sales rep, for customers whose orders they can see.
