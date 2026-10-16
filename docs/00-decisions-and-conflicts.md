# Decisions & conflicts — how the source documents fit together

The build specification (`01`) was written before the brand existed; the
design handoff (`02`) was written after. Where they overlap or disagree, this
file says which wins and why. **Read this before writing any code that touches
branding, the customer page, the marketing site, or integration status.**

Status legend: **DECIDED** — build it this way. **DEFAULT — CONFIRM** — build
the default, but flag it to the product owner at the end of the relevant
phase. **OWNER TASK** — not a coding task; listed so nothing gets lost.

---

## A. Precedence rules

1. **What to build and how it behaves** → build specification (`01`).
2. **How it looks, what it's called, and what the copy says** → design
   handoff (`02`) + `design/tokens.css` + mockups.
3. **How each external system is connected** → `docs/integrations/*`.
4. **This file** overrides all three where it says so.
5. If something still conflicts, stop and ask rather than pick silently.

---

## B. Conflicts resolved

### B1. Brand palette — DECIDED
Spec §13.2 suggests an ink/amber/slate palette (`#1A1307`, `#B57C15`…). That
was a placeholder. **The COAST palette in the handoff §4 replaces it
entirely.** Spec §13 is superseded and has been trimmed in `01` to a pointer.

### B2. Product name — DECIDED
The product is **COAST** (always capitals; Centralised Order And Shipment
Tracking). Company: COAST Visibility Ltd. Use `coast` for the repo, package
name and code identifiers.

### B3. Integration status on the marketing site — DECIDED
The Integrations mockup shows all eight carriers as "Live". The handoff's own
content rule (§8) says *never advertise anything as live unless it is*, and the
carrier guide says no carrier should be assumed to work until tested.
**Resolution:** every status pill on the Integrations page (and the carrier
list in the FAQ) is driven by a single typed config file
(`src/content/integrations.ts` or similar), not hard-coded in JSX. Initial
values:

| Item | Initial status |
|---|---|
| DHL Express, FedEx, UPS | Ready to connect |
| TNT (via FedEx credentials) | Ready to connect |
| DPD, Royal Mail/Parcelforce, Evri, Yodel | In development (beta) |
| Supplier confirmation links | Live once Phase 2 ships, otherwise In development |
| Supplier email reading | Live once Phase 2 ships, otherwise In development |
| Microsoft 365 mailbox | Ready to connect |
| NetSuite | In development |
| Carrier aggregator | Planned |

The product owner flips a value to "Live" when it's genuinely working against a real
account. Keep the "some connections run in beta" note.

### B4. "Full audit trail" claim on the Pricing page — DECIDED
The Pricing/Security section promises a full audit trail; the spec only has
one as a §11 recommendation (Phase 9). **Resolution:** build the audit log in
**Phase 1** alongside the core schema (an append-only `audit_log` table:
actor, org, entity, entity id, field, old value, new value, timestamp, written
by a single helper the data layer calls on every mutation). This makes the
marketing claim true and is cheaper than retrofitting.

### B5. White-label customer page — DECIDED
The customer tracking page design is white-label (business logo/name top-left,
"Tracking by COAST" top-right). Spec §7.2 treats white-label as roadmap.
**Resolution:** in Phase 5 build the **branding resolver** — one function,
`getBranding(orgId)`, returning display name, logo URL, colours, email
from-name/reply-to and `showPoweredBy`, falling back to COAST defaults. Every
customer-facing page and email reads branding through it. Store only
`display_name` and `logo_url` per org in v1 (set via seed/admin SQL). The full
branding settings UI, custom colours, contrast check and custom domains stay
roadmap behind an org-level feature flag (default off), exactly as spec §7.2.

### B6. Customer progress tracker vs. three fulfilment routes — DECIDED
The customer page shows five stages (Ordered → Confirmed → Dispatched → In
transit → Delivered). Internally, each fulfilment route has its own stage
sequence (handoff §7.5). **Resolution:** the masking function maps every
internal stage onto the five customer stages. "Via warehouse" stages Inbound
and Received both map to *Confirmed* (the customer never sees the goods-in leg
— that would reveal there's a supplier). "From stock" skips straight from
Ordered to Dispatched (Confirmed is shown as complete). This mapping lives in
the pure-logic layer with its own tests.

### B7. Sign-in "Track an order" — tracking code + postcode — DECIDED
The Sign-in mockup lets a customer track with a **tracking code + delivery
postcode**, which the spec doesn't describe (it only has tokenised links).
**Resolution:** add it. "Tracking code" = the order's customer-facing
reference (SO number) — never a PO number or a carrier tracking number of a
direct-ship (that could expose the origin). Match is case-insensitive and
postcode whitespace-insensitive; on success, issue a short-lived
order-scoped token and redirect to the normal tracking page. Rate-limit
per IP and per code (spec §11 already requires rate limiting on public
endpoints). Identical error message for "no such order" and "wrong postcode".

### B8. Customer-facing word for "supplier" — DECIDED
Spec §5.7 makes this an org setting. The design uses **"Shipper"** (e.g. the
`SHIPPER UPDATE` badge). Default the setting to "shipper".

### B9. App navigation vs. roles — DECIDED
The App mockup sidebar is the Procurement/Admin view: Orders, Purchase orders,
Review queue, Chases, Shipments, Suppliers, Metrics, Settings. Add role-scoped
items from the spec that the mockup doesn't show: **Home** (spec §5.6, first
item for every role), **Updates** feed, **Goods-in** (Goods-in role sees only
Home + Goods-in), **Team** inside Settings for Admin. Director sees everything
read-only (no "New order" button, no mutation controls rendered). Sales sees
Orders, Chases, Updates, Metrics; no supplier names (see C4).

### B10. Website roadmap column vs. spec Core features — NOTED
The marketing roadmap lists Goods-In view, Director reporting view and
Two-way messaging as "Later this year", while the spec treats them as Core.
No conflict for the build — the spec decides what gets built. Drive the
roadmap columns from the same content config as B3 so the product owner can move items as
they ship.

### B11. Stack — DECIDED
Spec §9.1 gives examples rather than mandates. Adopt them:
**Next.js (App Router, TypeScript strict) + Supabase (Postgres, RLS, Auth,
Storage) + Vercel (hosting + Cron)**. One Next.js app with route groups:
`(marketing)` public site, `(app)` internal staff app, `(portal)` customer
tracking/portal, plus `app/api/cron/*` and `app/api/inbound/*` for scheduled
jobs. Sora via `next/font/google`. Tests: Vitest for pure logic, Playwright
for a handful of critical flows, pgTAP or SQL tests for RLS.

### B12. Scheduled jobs — DECIDED
All three integration guides describe the same mechanism: an external
schedule hits an HTTPS endpoint guarded by a long random secret. Use Vercel
Cron (or GitHub Actions schedule if the Vercel plan limits frequency) calling:
`/api/cron/inbound-mail` (5–15 min), `/api/cron/netsuite-sync` (15–30 min),
`/api/cron/tracking-poll` (15–30 min, one run covers every configured
carrier), `/api/cron/notification-digest` (daily). Each checks
`Authorization: Bearer ${CRON_SECRET}` and records its last run + outcome so
the health screens can show it.

### B13. File storage — DECIDED
Spec §8/§11 asks for a decision. **Yes, in v1:** Supabase Storage with an
`attachments` table (org-scoped via RLS, polymorphic `entity_type`/`entity_id`).
Used first for delivery-exception photos in Phase 7.

### B14. Working-time calendar — DEFAULT — CONFIRM
Weekdays only in v1, with the escalation engine taking a `holidays: Date[]`
parameter (empty by default) so England & Wales bank holidays can be added
later without changing callers. "UK bank holiday awareness" is already on the
website roadmap as "Exploring".

### B15. Multi-line supplier email confirmations — DEFAULT — CONFIRM
Single-line POs can auto-apply at high confidence. Any confirmation for a
multi-line PO goes to the review queue in v1, with the parsed values
pre-filled per line for one-click acceptance.

---

## C. Spec §10/§14 open decisions — defaults to build against

| # | Question | Build default | Status |
|---|---|---|---|
| C1 | Internal tool or multi-tenant product? | **Multi-tenant product** — the brand, pricing page and "COAST Visibility Ltd" all imply it. Architecture is org-scoped from day one. **No billing/self-serve sign-up in v1**; new orgs are created by an admin script. | DEFAULT — CONFIRM |
| C2 | Product-availability source | Manual entry + CSV upload only | DECIDED (spec default) |
| C3 | Delivery-exception categories | damaged, short/missing, wrong item, not received, late, faulty/DOA, other | DECIDED (spec default) |
| C4 | Do Sales reps see supplier identity? | **No** — a rep-safe projection, separate from the customer one | DEFAULT — CONFIRM |
| C5 | Fallback recipient for customer messages | Procurement role | DECIDED (spec default) |
| C6 | Domestic-to-territory counts as customs-relevant? | Yes, per-org setting (GB→NI, GB→Channel Islands/IoM are the obvious cases) | DECIDED (spec default) |
| C7 | Customer wording for a customs hold | "Customs checks in progress — we're on it." | DECIDED (spec default) |
| C8 | Customers report problems directly? | Yes, from the portal | DECIDED (spec default) |
| C9 | Carrier claim windows | Per carrier connection, blank until set | DECIDED (spec default) |
| C10 | Accessibility target | **WCAG 2.1 AA** everywhere, mandatory on customer and marketing pages. The palette's Tide Teal Deep rule (handoff §4) already assumes it. | DECIDED |
| C11 | Responsive scope | Fully responsive: marketing, sign-in, customer page, Goods-in. Internal Orders/Reports: usable at tablet width, tables scroll horizontally on phone. | DECIDED |
| C12 | Interface language | English (UK) only; keep all user-facing strings out of logic so translation stays possible. Dates in `en-GB` format ("Thu 16 Oct"). | DECIDED |
| C13 | Currencies | GBP, EUR, USD as an explicit enum/list table | DECIDED (spec default) |
| C14 | Public API / webhooks | Not in v1. Keep the unified-feed event type clean, versioned and typed so it can be published later. | DECIDED |
| C15 | Environments | Local (Supabase CLI), staging, production. A seed script producing realistic `[Placeholder]` demo data. | DECIDED |

---

## D. Owner tasks (not for Claude Code)

- Trademark and domain clearance for "COAST" — before public launch.
- Terms of Service, Privacy Policy, cookie consent wording, Data Processing
  Agreement template (spec §14). Code builds the pages and the cookie banner;
  the wording comes from a solicitor.
- Pricing figures — every `[X]` and `[£ PRICE]` on the Pricing page stays a
  placeholder until set.
- Carrier, Microsoft 365 and NetSuite credentials — see `docs/integrations/`.
  Credentials go into environment variables only; never commit them, never
  paste them into chat.
- Permission to show real carrier logos (until then: monogram tiles).

---

## E. Product-owner decisions — 14 October 2026

These override the defaults above where they speak.

### E1. Sales visibility — DECIDED (replaces C4)
Sales reps see **all orders**. The Orders screen opens filtered to the rep
viewing it ("My orders"); they can switch to "All" or to any other rep.
Sales see **supplier names and costs by default**; each company's admin can
switch either off (E2). Where a role can't see supplier identity or costs,
internal screens use a permission-scoped projection with no field for them
(the same structural approach as customer masking) — RLS enforces it too, by
keeping supplier identity and costs in tables whose policies check
`has_permission()`.

### E2. Who sees what is set per company by its admins — DECIDED (replaces fixed role rules)
Every screen, kind of data (everyone's orders, supplier names, costs) and
action is a permission the organisation's admins switch on or off per role,
in Settings → Who sees what. Defaults: `src/lib/logic/permissions.ts`,
mirrored in `supabase/migrations/0003_permissions.sql`; tests fail if they
drift. RLS uses `public.has_permission('<key>')`.
- **Everyone can open Settings** by default; changing company settings is a
  separate permission (admin only by default).
- **Admins always have everything** and can't be switched off — no
  organisation can lock itself out.
- **Changing team and permissions is admin-only** and can't be delegated (so
  nobody can grant themselves more).
- Each later phase adds its new permissions (e.g. customer messaging) to the
  list with sensible defaults.
- Per-person overrides (one user different from their role) are not built;
  role-level only for now.

### E3. Directors — DECIDED
See everything; view-only by default ("metric tracking"). An admin can switch
on any action for directors, e.g. editing orders when a director needs to
step into a big order.

### E4. Customer tracking codes — DECIDED (amends B7)
Each order gets a random, hard-to-guess tracking code (like `K7Q-4M2-XP9`),
never the SO number.
- **With a customer account:** the customer enters the code to add the order
  to their account. Once added, they can find their orders by **their own PO
  number** or **the SO number**.
- **Without an account:** the code alone tracks that one order. (The
  sign-in mockup also asks for a postcode; per this decision it isn't
  required. Can be added back as an extra check if wanted.)
- Rate limiting and identical "not found" messages from B7 still apply.

### E5. Billing — DEFERRED
Multi-tenant product (C1 confirmed). Billing comes later, if COAST is sold
publicly. Not built now: it needs real prices, terms and a payment-provider
account, and nothing built now blocks adding it.

### E6. Commit identity — DECIDED
Commits use the GitHub username with GitHub's noreply address. Dedicated
COAST email addresses can replace it later.

### E7. Sales manager role and individual access — DECIDED (14 October 2026)
A **Sales manager** role so admins don't have to do everything:
- Starts with the same access as Sales, plus **Manage sales reps' access**.
- Can give or take away permissions for **individual sales reps** — only
  permissions the manager holds themselves, and never the power to manage
  others. Can't change themselves, admins or other roles.
- Admins can change any non-admin person individually, for any permission.
- Individual changes sit on top of the role ("Same as role" / "Allow" /
  "Block"), in Settings → Team and individual access.
- A sales manager covers all sales reps in the company for now; separate
  teams per manager can be added if needed.
- Enforced in the database by `public.can_manage_person_access()` and
  `staff_permission_overrides` (migrations 0004–0006), mirrored by
  `canManagePersonAccess()` / `grantablePermissions()` in
  `src/lib/logic/permissions.ts`.

Settings is organised into collapsible sections (Who sees what — split into
Screens / Data / Actions; Team and individual access — one fold-out per
person; Connections), closed by default with a one-line summary each.

---

## F. Build notes — Phase 1 (14 October 2026)

### F1. Audit log is written by the database, not an app helper — DECIDED (strengthens B4)
B4 asked for "a single helper the data layer calls on every mutation". It is
instead a database trigger (`public.audit_row_change()`) on every business
table, so no code path — app, script or future integration — can skip it.
Nobody can update or delete audit rows through the API (not even admins or
the service role). Admins and anyone with the "Audit log" permission
(directors by default) can read it in Settings.

### F2. Order history is written by the database too
`order_events` (order created, PO raised, PO status changed, line stage
changed) is filled by triggers, never by app code, and never contains a
supplier name or cost — PO references are ids, resolved at read time only for
people allowed to see them.

### F3. Tracking codes exist from Phase 1
Every order gets its random tracking code (E4) when it's created, so codes
printed or emailed before Phase 5 still work once the tracking page opens.

---

## G. Build notes — Phase 2 (14 October 2026)

### G1. Confirmation links — DECIDED
- A link is 256 random bits; only its SHA-256 hash is stored. It expires
  after **30 days** and staff can revoke it. One live link per PO: making a
  new one (or chasing) revokes the old.
- Because the code is never stored, staff see a new link **once**, on
  screen, with a Copy button. Stored copies of emails show the link as hidden.
- The supplier's page shows only the supplier-safe projection (spec §7.1):
  lines, quantities, requested dates, the PO price, and the delivery address
  for direct-ship lines. Never the customer's price, margin or notes.
- Link answers are structured, so they apply automatically when they match
  the PO exactly; any difference (quantity, price, later date, can't supply)
  goes to the review queue.

### G2. Reading supplier emails — DECIDED (B15 honoured)
Deterministic rules: dates in UK formats, PO numbers, prices and currencies,
tracking numbers (UPS by shape, others only when labelled), and wording that
confirms, says "can't/delayed", or mentions a partial delivery. The quoted
original email is ignored. High confidence (applied automatically) only when
it's about this PO, clearly confirms, gives exactly one date, nothing negative
or partial, and the PO has one line. Everything else goes to review with the
reasons shown and the values pre-filled.

### G3. Escalation — DECIDED (B14 default kept)
One engine (`src/lib/logic/escalation.ts`). Working hours: Monday–Friday,
09:00–17:00 UK time by default, adjustable per company in Settings → Chasing,
with defaults of 8 / 16 / 24 working hours (one, two and three working days)
for overdue / very overdue / needs attention. Bank holidays can be passed in
later without changing callers.

### G4. Chasing
Procurement chases a supplier from the PO (a chase email is written and a
fresh link included). Anyone with "Chase procurement" (sales, sales managers,
procurement by default) asks procurement about a line from the order page;
procurement (or whoever asked) answers and closes it. A supplier's answer
closes any open supplier chase.

## H. Build notes — Phase 3 (14 October 2026)

### H1. One shipment belongs to one order, on one leg — DECIDED
A shipment carries one or more lines of one order, on one of three legs:
**inbound** (supplier → our warehouse, for "via warehouse" lines),
**to the customer** (from stock, or onward from the warehouse) and **direct
from supplier** (direct-ship lines). Shipments from a supplier (inbound and
direct) are hidden from anyone without "Supplier names", because a tracking
number can lead to the supplier (E1, masking). A new permission, **"Add and
update shipments"**, is on for procurement by default; everyone who can see
an order sees its shipments.

### H2. Statuses and line stages — DECIDED
Six shipment statuses: booked (not collected), in transit, out for delivery,
delivered, problem, not known yet. Carrier statuses map onto these; DHL's
"out for delivery" is read from its wording. A shipment moving pulls its
lines forward (never back): in transit → "In transit", delivered →
"Delivered"; inbound shipments stop at "In transit to us" until goods-in
(Phase 6). A status or customs status set by hand sticks until someone hands
it back to the carrier (non-negotiable 3).

### H3. Customs — DEFAULT — CONFIRM
A shipment to the customer is international if the delivery address is
outside GB, or in Northern Ireland (BT postcodes, decision C6). Customs status
is read from carrier wording (latest customs mention wins) and is "Not known"
when nothing says. Every organisation is assumed to be UK-based.

### H4. Polling — DECIDED (B12, carrier guide)
One job, `/api/cron/tracking-poll`, every 30 minutes, run by GitHub Actions
(Vercel's free plan only allows daily jobs). Checks get rarer as a parcel
settles: 30 minutes when out for delivery, 1 hour for a problem, 2 hours in
transit, 4 hours when booked or unknown; delivered stops. Failures back off
from 30 minutes, doubling, up to a day. DHL's 250 a day are spread across the
day's runs, with 10% kept for "Check now"; a run makes at most 9 DHL calls
(one per 5 seconds) to finish inside a minute. Every run is logged
(`cron_runs`) and shown in Settings → Carrier connections.

### H5. Carriers without public APIs — DECIDED
DPD, Evri and Yodel publish no tracking API. Rather than send a company's key
to a guessed address, COAST lists them as beta and doesn't call them until
their integration packs arrive. Royal Mail's portal is semi-public, so its
adapter is built best-effort and shown as beta.

### H6. Tracking numbers from suppliers become shipments — DECIDED
When a supplier's pasted reply is applied (or accepted from the review
queue), each tracking number in it becomes a shipment on the PO's lines,
per order. The carrier is filled in only when the number's shape is
unmistakable (UPS `1Z…`, Royal Mail `…GB`, DHL 10 digits, FedEx 12/15/20/22
digits); otherwise it shows "Carrier not known yet" under Needs attention.

### H7. Claim windows — DECIDED (C9)
Settings → Carrier connections holds a claim window per carrier for each
company, blank until set. It's used by delivery exceptions in Phase 7.

## I. Build notes — Phase 4 (14 October 2026)

### I1. Where a delivery date comes from — DEFAULT — CONFIRM
Spec §4 lists the sources as manual override → supplier-confirmed date →
supplier's typical lead time → carrier ETA. COAST uses the carrier's ETA
**before** the supplier's date once the goods are actually heading to the
customer, because by then the carrier knows better than anyone; before
dispatch the carrier has nothing to say, so the spec order applies. For
"via warehouse" lines, the inbound carrier or supplier date is when goods
reach us, then turnaround + delivery days are added.

### I2. Defaults — DEFAULT — CONFIRM
Turnaround 1 working day, own delivery 2 working days, estimates 2 working
days wide (Settings → Delivery dates). Lead time counts from the day the PO
was sent (from today if it hasn't been).

### I3. At risk — DEFAULT — CONFIRM
At risk when the **latest** likely date is after the promised date (so an
order is flagged while there's still time to act), or the promised date has
passed undelivered. No promised date → never flagged, and the order page
says so.

### I4. Sticky values — DECIDED (non-negotiable 3)
A delivery date (or range) set by hand on an order, and a lead time set by
hand on a line, are never changed by COAST until someone hands them back.
The rule lives in `src/lib/logic/prediction.ts` so no caller can skip it.

### I5. Lead-time ticker
Internal only: "Day 3 of 5", or "2 working days over its 5-day lead time",
for supplier lines still waiting on their supplier.

## J. Build notes — Phase 5 (14 October 2026)

### J1. The masking layer — DECIDED (non-negotiable 1)
`src/lib/logic/masking.ts`: `toCustomerView` is the only function that builds
a `CustomerOrderView`, whose type has no field for a supplier name, PO
number, cost, internal note or shipment origin. Every customer page and
email is built from it, then scanned (`assertViewIsClean`) against every
supplier name in the company and the order's PO numbers; a hit refuses the
page. Staff replies are scanned the same way and blocked with the reason.

### J2. What customers see of shipments — DEFAULT — CONFIRM
Our own shipments to the customer show the carrier and tracking number.
Shipments straight from a supplier show only plain statuses ("Dispatched",
"In transit") with a "SHIPPER UPDATE" badge, never the carrier's own words
or places (they can name the supplier's town) — unless the company switches
on "Show the carrier for direct shipments" in Settings → Customer page.
Inbound shipments to the warehouse are never shown (B6).

### J3. Tracking without an account — DECIDED (E4)
The tracking code alone opens the order's page (no postcode box). Codes are
9 characters from a 31-letter alphabet; lookups are rate-limited and a wrong
code gets the same answer as a missing one.

### J4. Notifications — DEFAULT — CONFIRM
Default level "Key milestones": date confirmed, dispatched, delivered,
problems, replies. Routine updates at most every 4 hours (held ones folded
into the next); date changes only when the date moves 2+ days or crosses the
promised date; "may be late" and replies always go at once; an optional
daily summary. All per company in Settings → Customer page.

### J5. Customer accounts — DEFAULT — CONFIRM
Staff invite a customer from the order (permission "Talk to customers", on
for procurement, sales and sales managers). A customer login can never be a
staff login. Customers add further orders with their tracking codes.

## K. Build notes — Phase 6 (14 October 2026)

### K1. Customers can create their own account — DECIDED (product owner, 14 October 2026)
A tracking code from one of their orders is the proof that they deal with
the business, and decides which customer the account belongs to. Email
confirmation waits for real email (Phase 8).

### K2. Goods-in sees a narrow view — DEFAULT — CONFIRM
Warehouse staff don't get "everyone's orders". Two database functions give
them exactly what check-in needs (what's due, from whom, for which order)
and record check-ins, checking `goods_in.check` themselves. A full, good
delivery moves the line to Received and closes the inbound parcel; short,
damaged or wrong deliveries are recorded and leave the line waiting.

### K3. What counts as "waiting" and as a "problem" — DEFAULT — CONFIRM
Waiting (Chases): unsent POs and answers to review (on procurement),
unconfirmed POs (on the supplier, from when it was sent or last chased),
internal chases (on procurement), unread customer messages (on us), delivery
problems and customs holds (on the carrier). One escalation engine, Settings
→ Chasing thresholds. Problems (Updates, Home): an order turning at risk, a
delivery problem, a supplier answer needing review, a customer message, a
bad check-in, a cancelled PO, a supplier being chased.

## M. Build notes — Phase 7 (15 October 2026)

### M1. Who handles delivery problems — DEFAULT — CONFIRM
New permission "Handle delivery problems" (`problems.manage`) and screen
"Delivery problems" (`section.problems`). By default procurement and sales
(both kinds) have both, directors can look, goods-in can't (they report
problems by checking a delivery in as damaged, short or wrong). Admins can
change this per role.

### M2. Problems COAST opens by itself — DEFAULT — CONFIRM
A carrier saying "problem" (or someone setting a shipment to it by hand)
opens one problem per shipment; goods-in checking something in damaged,
short or wrong opens one for that line. They start as "New" for a person.

### M3. What customers see of a problem — DEFAULT — CONFIRM
Only problems they reported, with four customer-safe phrases. Waiting on
the supplier and waiting on the carrier both read "We're sorting it out",
so a customer can't tell a supplier is involved. They get an email when
their report moves on (unless they chose no updates at all).

### M4. Northern Ireland and the islands — DEFAULT — CONFIRM (C6)
Settings → Customs has a switch, on by default, to treat mainland →
Northern Ireland, Jersey, Guernsey and the Isle of Man as customs. Either
way each of those shipments asks a person to confirm.

## L. Product-owner decisions — the customer portal as the way in (14 October 2026)

### L1. One COAST account across every business — DECIDED
A customer has one free COAST account that shows orders from every business
that uses COAST, grouped by business (shown to them as their suppliers),
the one with the earliest delivery first, with an "Arriving soon" list
across all of them when there's more than one. Their pages are still built
only through the masking layer, so they never see any business's suppliers.

### L2. How orders get into the account — DECIDED
- A tracking code, or "Add to my COAST account" on a tracking page: that one order.
- Automatically, only when a business vouches for the person (staff invite
  them from an order): that customer's orders from the last year and every
  new one. A forwarded tracking link never exposes more than its own order.
- Later (needs real email, Phase 8): automatic adding when a confirmed
  account email matches the address the business holds for that customer.

### L3. Signing businesses up — DECIDED (billing still deferred, E5)
Every tracking page and the portal invite visitors to "Get COAST for your
business": a register-interest form that records which business's page
sent them (`npm run leads` lists them). **A self-serve free trial is noted
for a later phase.** The invitations show on every business's tracking
pages for now; hiding them becomes a paid-plan option later.

## N. Pilot readiness plan, Branches and Projects (16 October 2026)

The plans are `docs/04-pilot-readiness-plan.md` (Tasks 1–6) and
`docs/03-branches-and-projects.md` (Phases 7b, 7c). They come after Phase 7
and before Phase 8, in the order the readiness plan gives, then 7b and 7c.

### N0. Any number of organisations — DECIDED
COAST is built for an unlimited number of organisations from now on. The
database already was (every table is scoped by organisation with RLS); what
assumed one company was the integrations: carrier keys and the Microsoft 365
mailbox read from the hosting settings, and one DHL allowance shared
platform-wide. Tasks 2–4 replace those with per-organisation credentials,
per-organisation inbound addresses and per-shipment tracking. Nothing new
may assume a fixed number of tenants.

### N1. The website keeps an audit-trail claim, worded exactly — DECIDED
The plan said to remove "Full audit trail". COAST has had a real audit log
since Phase 1 (F1: written by the database itself, visible to admins and
directors). The site says what's true: every change recorded with who, what
and when; the truth test covers it.

### N2. Integrations and Pricing pages are built now — DECIDED
They didn't exist yet (the public site was a holding page). Task 1 builds
them from the mockups with the truthful wording.

### N3. Credential encryption: COAST encrypts — DECIDED
AES-256-GCM in one server-only module, master key only in the hosting
settings, key version stored on each record so keys can rotate. Backups
never hold a usable key.

### N4. Already in place (checked, not rebuilt)
- Supplier link codes are already stored only as a hash, expire after 30
  days, can be revoked from the PO, and opening the link never submits it
  (the supplier presses "Send confirmation"), so email scanners can't use
  it up. Task 5B adds configurable expiry and tests.
- "Show direct-ship carrier to customer" already defaults to off (0016).
- The database is in the EU (Ireland, eu-west-1).
- Paste-in replies are a staff action, so a clear pasted date still applies
  itself; Task 3's "never auto-apply" covers forwarded mail.

### N5. Managers — DECIDED by E7
The Sales manager role already exists. In 7b they get "See every branch" by
default.

### N6. "Sees every branch" is a permission — DEFAULT — CONFIRM
Not a hard-coded role list (CLAUDE.md non-negotiable 7): admin, procurement,
director and sales manager hold it by default; admins can change that.

### N7. Customer-facing project wording follows B8
Customers see a business's word for things, never "supplier".

### N8. Two-person approval with one approver — DEFAULT — CONFIRM
If an organisation has only one active admin or procurement user, they can
approve their own participant request; it is audited as "approved without a
second person".

### N9. Customer-created project groups belong to the account — DEFAULT — CONFIRM
Customer accounts are people who follow orders across businesses (L1), so a
group belongs to that account. Sharing groups within a customer's company is
for later.

### N10. Inbound email provider: Mailgun, EU region — DECIDED (product owner, 16 October 2026)
EU data residency, signed webhooks, and it passes on each email's sender
checks. Each organisation's address is `r-<30 random hex>@INBOUND_EMAIL_DOMAIN`,
made by the database. Setup: `docs/integrations/inbound-email.md`.

### N11. What counts as "proven" and "known" for auto-apply — DEFAULT — CONFIRM
A supplier's emails are proven after 3 clean answers in the last 180 days
(read with certainty and applied, or accepted at review without a note, and
not undone). A known contact is the supplier's email or one listed under
Suppliers → Other addresses. The people told about an automatic date are
the sales reps on the PO's orders, or procurement if none.

### N12. Microsoft 365 reads only new mail — DEFAULT — CONFIRM
After consent, COAST reads mail arriving from then on, never the existing
inbox. Unmatched or held-back emails go to an "Emails to sort out" list in
the Review queue, where procurement attaches them to a PO or dismisses them.

### N13. Aggregator tracking defaults — DEFAULT — CONFIRM
Provider: still the founder's choice (the code takes any, as a setting).
Cost: 5p a shipment until the real price is known. Cap: 5% of the plan
price, "near" at 80% of that; near or over, checks happen a quarter as
often and the founder is emailed once per level per month; tracking never
stops. A shipment on an organisation's own carrier account stays direct;
the test carrier always does. With webhooks, COAST still checks once a day
as a safety net; without, every 2 hours near the delivery date, 8 hours
normally, once a day after 3 quiet days, never once delivered.

### N14. Two-step sign-in and its exemption — DEFAULT — CONFIRM
Every staff member of every real organisation must use an authenticator
app, enforced in the database (`organisations.require_staff_mfa`, not
changeable by anyone signed in). The two demo organisations used by
automated tests are exempt; they hold no real data. An admin can reset a
colleague's authenticator (a lost phone), logged in the security log.

### N15. Sign-in lockout and limits — DEFAULT — CONFIRM
5 wrong passwords for one address in 15 minutes pauses that address for 15
minutes (any address, so it reveals nothing); 30 attempts per visitor per
10 minutes; 10 wrong authenticator codes per 15 minutes; 5 password resets
per visitor per hour. Supplier link: 60 opens per visitor per 10 minutes,
15 wrong codes, 20 answers an hour. Link lifetime: a company setting, 1–90
days, default 30.

### N16. Processing stays in the EU — DECIDED
Database in Ireland (eu-west-1); Vercel functions pinned to Dublin (dub1)
in `vercel.json`.

### N17. Demo data stays as placeholders — DECIDED (CLAUDE.md wins)
The readiness plan asked for "realistic, entirely fictional" demo data;
CLAUDE.md says seed data uses obvious placeholders (`[Customer A]`,
`SO-10421`). Placeholders are fictional and can't be mistaken for real
companies, so they stay.

### N18. What retention and "remove a person" clear — DEFAULT — CONFIRM
Both keep the order history (orders, lines, POs, shipments, delivery
addresses). "Remove a person" clears their email wherever it's stored in
this organisation, emails to and from them, their supplier-contact entries,
and — when their name is given — their messages and problem reports.
Retention (off by default, 1–120 months) clears customers' update emails,
message text and problem reports on closed, inactive orders.

### N19. Metering — DECIDED (readiness plan)
One sales order, counted once, in the UK calendar month it was first seen.
