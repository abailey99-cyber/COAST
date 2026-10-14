# Order-to-Delivery Platform — Build Specification

*Product scope, user flow, full feature set, technical architecture and roadmap for a ground-up build.*

13 October 2026 · Converted to Markdown for the COAST build pack, 14 October 2026.

> **Pack note:** the platform is now branded **COAST**. Section 13 (branding
> starter prompts) has been superseded by `02-design-handoff.md` and trimmed
> to a pointer. Where this document and the design handoff disagree, see
> `00-decisions-and-conflicts.md`. Otherwise the text below is unchanged.

---

## 0. About This Document

This is a complete build specification for a B2B order-tracking and customer-communication platform, covering what it does, how an order flows through it end to end, every feature to build, the technical architecture, and what's still open or roadmap. It's written as a forward-looking specification — a blueprint to build against, not a record of anything else.

Three tiers are used throughout to separate what's ready to build immediately from what needs more product thinking first:

- **Core** — specified in full, including the data model and the logic involved, and should be built first.
- **Needs external connection** — specified and ready to build, but depends on a real account/credential with a third party (an email provider, an ERP, a carrier) before it does anything live.
- **Roadmap** — agreed in principle and scoped at a product level, but not specified in enough detail to start building yet.

## 1. What It Is

A purpose-built order-tracking and customer-communication platform that gives sales, procurement and customer-service staff a single place to see and manage an order from the moment it's placed with a supplier through to the moment it lands on the customer's doorstep — "PO-to-doorstep" visibility, not just "where's the parcel."

It replaces a patchwork of spreadsheets, email threads and phone calls to suppliers and carriers with one record per order that every relevant person can see, act on, and trust is up to date. Customers get their own live tracking view and a direct line to ask questions — without ever being able to find out who the supplier behind an order actually is.

### The problem it solves

- Staff have no single record of an order's journey — chasing a supplier for a confirmation, or a carrier for a status, means digging through inboxes with no shared history.
- Customers have no way to check their own order's progress, so "where's my order" calls and emails land on whoever picks up the phone, not necessarily the person who actually knows.
- Revealing a supplier's identity to a customer is a real commercial risk — a customer who knows exactly who fulfils an order can go around the business direct to that supplier — so anything customer-facing has to be structurally incapable of leaking that, not just careful about it.
- Nothing tracks whether a delivery date is actually going to be hit until it's already too late to do anything about it.
- When something goes wrong after delivery — damaged, missing, wrong item — there's no structured record of it, no way to see patterns by supplier or carrier, and no escalation if it sits unresolved.

## 2. What Makes This Different

A handful of deliberate design decisions, held consistently across the whole build rather than applied in one or two places, are what actually make this defensible as a product rather than a database with a UI on top. Keep every one of these throughout the build — they're cheap to build in from the start and expensive to retrofit later.

### Masking is structural, not a display rule

Anything a customer can see — a screen or an email — is built from a deliberately narrow, separate version of the order data: a type that has no supplier-name field, no PO-number field, no internal-price field for it to leak, rather than the full internal record with a display rule that happens not to render them. One function, in one place, is the only thing allowed to turn the real record into the customer-safe one, and it's covered by tests that actively try to make sensitive content leak through — including scanning free text (a staff reply to a customer) for a real supplier name or PO number before it's allowed to send. A new screen literally cannot introduce a leak by accident, because the data it has access to doesn't contain the thing that would leak.

### No AI or machine-learning model makes a live judgement call

Every automatic decision — reading a date out of a supplier's email, flagging a mismatch, escalating an overdue chase, predicting a delivery date, deciding whether to notify a customer — is deterministic, rule-based logic that a person can read, test, and reason about. Anything the rules aren't confident about is handed off to a human to decide via a review queue, rather than guessed at. This is a genuine product and trust decision, not a cost-cutting one — it means every automatic action is explainable after the fact.

### Business logic, data access, mutation and UI are four separate layers

Every feature follows the same shape: pure logic with no I/O at all (date math, escalation levels, which status transitions are valid, masking rules) — fully unit-tested, with time itself passed in as a parameter so tests are deterministic — sits underneath a data layer that only reads and writes, which sits underneath user-triggered actions that check auth and role before calling into the layers below, which sits underneath thin UI components that just call those actions. Nothing skips a layer. This is what makes the rule-based logic above actually trustworthy: the part that decides whether to escalate a chase, say, can be tested with hundreds of cases without touching a database at all.

### A human's decision is never silently overwritten

Anything the system recalculates automatically — a predicted delivery date, an internal lead-time estimate, a customs classification — checks first whether a person already set that value by hand, and backs off if so. An automatic background job can update a field a human hasn't touched; it can never quietly replace a value someone deliberately entered.

### It says "I don't know" rather than guessing

Wherever the system genuinely can't determine something with confidence — a customs status a carrier's tracking doesn't report, an availability figure that didn't parse as a number — that shows as an explicit unknown/uncertain state in the UI, not a best-effort guess presented as fact. Nothing is shown as more certain than the underlying data actually supports.

### One interface, many interchangeable adapters, each reporting its own health

Carrier tracking and product-availability sourcing are both built as a small adapter interface plus a registry that looks up the right implementation by name, with a uniform health-check shape (a status level and a human-readable reason) that every adapter must implement. Adding a new carrier or a new availability source is writing one new adapter against an existing interface, not touching the rest of the system — and every adapter's live connection status is visible in one place.

### One escalation engine, reused everywhere something can be "waiting on someone"

A single pure function computes an amber → red → alert escalation level from how many working hours something has been waiting and a set of configurable per-organisation thresholds. It's reused unmodified for an unconfirmed supplier purchase order, an internal procurement chase, and a delivery exception sitting in an awaiting-resolution state — rather than three separate, drifting implementations of "has this been ignored too long."

### Multi-tenancy is enforced by the database, not just the application

Every table is scoped back to an organisation — directly, or by join to a parent row that is — using row-level security policies defined in the database itself. A bug in a query, or a missing "where org_id =" clause in application code, cannot leak another organisation's rows, because the database refuses the read regardless of what the application asked for.

### Nothing is hand-edited; every change is a reviewable record

Every schema change is a sequential, numbered migration file, checked into version control, reviewed like any other code change — the production database is never altered by hand. Significant logic ships with its own automated tests. This is what makes "what does the system actually do right now" an answerable question at any point, rather than something that has to be reverse-engineered from a live database.

### Gaps are disclosed, not hidden

Every deliberate scope cut and every known limitation is written down and kept visible (see section 8) rather than silently shipped as if the feature were complete. This is a discipline worth keeping from day one of the build: a feature that's 80% done and says so is worth more than one that looks finished and isn't.

## 3. Roles & Access Model

### Internal roles

- **Admin** — full access: company settings, team management, everything Procurement can do.
- **Procurement** — creates and manages orders, suppliers and purchase orders, chases suppliers, resolves discrepancies and delivery exceptions.
- **Sales rep** — sees their own orders (and, read-only, everyone else's), can chase procurement internally for an update, can message customers, cannot edit order or supplier detail.
- **Director** — read-only across the whole business: every order, every metric, no ability to change anything — built for oversight and reporting.
- **Goods-in** — a focused, simplified screen for warehouse staff checking deliveries in against expected lines.

### External

- **Customers** — track their own orders via a login-based dashboard or a no-login link, and message the team directly about a specific order. They never see who supplies the goods, what the business pays for them, or any internal note.
- **Suppliers** (roadmap — see section 7) — not yet able to log in; currently reached only via a one-off, no-login confirmation link per purchase order.

Access control is role-based throughout, checked at the server-action layer (not just hidden in the UI), and every table's row-level security policy is written against the same role model — a role gets exactly the rows and the mutations appropriate to its job, enforced in the database as well as the application.

## 4. How an Order Flows Through the System

A walk-through of a typical order, start to finish:

1. An order is created — either entered directly, or synced automatically from the business's ERP system on a read-only, scheduled basis (the ERP stays the system of record; nothing is written back to it). Each line on the order is set to one of three fulfilment routes: from stock (already available, nothing to chase), via warehouse (comes in to the business's own warehouse before going out to the customer), or direct ship (the supplier ships straight to the customer).
2. For any line that needs a supplier, a purchase order is raised and sent — a real email goes to the supplier with a no-login link so they can confirm without creating an account.
3. An internal lead-time indicator starts tracking how long the line is genuinely likely to take, built from whichever source is most reliable at that moment: a supplier's own stated lead time, or product-availability data. A member of staff can override this by hand at any point, and that override is never silently replaced by a later automatic recalculation.
4. The supplier confirms by replying to the email. Once inbound email reading is connected, the reply is read automatically and, where the system is confident, the confirmed date is applied straight to the order; anything it isn't confident about — or where the supplier's confirmed price, quantity, SKU or date doesn't match what was ordered — is flagged for a member of staff to check in a review queue, rather than committed automatically.
5. If a supplier goes quiet, staff can flag and chase them directly from the order — the flag escalates automatically (amber, then red, then "needs attention") the longer it sits unconfirmed, so nothing slips through purely by being forgotten.
6. Goods arrive (at the business's warehouse, or direct at the customer) and a shipment is created, with a carrier and tracking number attached.
7. For connected carriers, tracking updates — status, location history and estimated delivery — are pulled in automatically on a schedule, with no one having to check a carrier's own website.
8. For an international shipment, a customs status is derived from whatever a carrier's own tracking events actually report, with required customs documents tracked against what's actually been received; where a carrier doesn't report customs detail, staff can set the status by hand rather than the system guessing.
9. Throughout all of this, the order's predicted delivery date is continually recalculated from whichever source is most reliable at that moment (a manual override, a supplier's confirmed date, their typical lead time, or the carrier's own ETA). If that predicted date slips past what the customer was promised, the order is automatically flagged "at risk" — no one has to notice it manually.
10. If something goes wrong at or after delivery — damaged, short/missing, wrong item, not received, late, faulty — a structured record is opened: by the customer reporting it themselves from their portal, automatically from a carrier's own delivery exception (returned, damaged, lost), or by a member of staff raising one directly. It's triaged, tracked through to whoever it's currently waiting on (supplier, carrier or customer), and carried through to a resolution — replacement, credit, return, refund, or no action needed. Where a carrier's claim window applies, that deadline is tracked with its own escalating health so it can't quietly expire.
11. The customer can watch all of this happen in their own portal (built entirely from the masked, supplier-free version of the data) and can message the team at any point — a question, a request, anything. Any member of staff can reply from inside the order; every reply is automatically checked before it sends, so a supplier's name or a PO number can never accidentally go out in a message.
12. The customer decides, once, how much they want to hear about all this automatically — everything, just the key milestones, just problems, or nothing beyond replies to their own messages — and can change their mind at any time from a link in every email they get.
13. Delivered (or resolved). The order's full history — every supplier confirmation, every chase, every carrier scan, every customer message, every delivery exception, every notification sent — stays on the record permanently, in one place.

## 5. Feature Reference — Core

Everything in this section is Core (see section 0): specified in full and ready to build first.

### 5.1 Order & Procurement Management

- **Orders screen** — every order in the business, searchable by order number, customer, the customer's own reference/PO number, the business's own internal PO number, supplier, carrier or tracking number; filterable by status, by what's currently flagged, and by customs attention needed.
- **Multi-line orders with three fulfilment routes** — from stock, via warehouse, or direct ship, each tracked through its own relevant stages.
- **Supplier & purchase order management** — supplier records, purchase orders per line, multi-currency support (at minimum GBP/EUR/USD — designed so adding a currency is a small change, not a redesign).
- **Automatic supplier-email reading** — paste in (or, once an inbound mail provider is connected, automatically receive) a supplier's confirmation email; dates, confirmations and tracking numbers are read out of it automatically. High-confidence reads commit straight to the order; anything less certain is queued for a human to check in a review screen — nothing is ever silently guessed. Reusable templates let a given supplier's email format skip the review queue once it's proven reliable.
- **Discrepancy detection** — if a supplier's confirmed price, quantity, currency, SKU or date doesn't match what was actually ordered, it's automatically flagged for review rather than accepted.
- **Supplier chase workflow** — flag a supplier who's gone quiet, mark them chased, resolve once they respond; unconfirmed flags escalate automatically through amber → red → "needs attention" the longer they sit, on a configurable, weekday-aware timer.
- **Internal procurement chase** — sales or customer-service staff can chase procurement for an update on any line directly from the order, without needing to go around them.
- **Automatic delivery-date prediction** — recalculated from whichever source is most reliable at that moment (manual override → supplier-confirmed date → supplier's typical lead time → carrier ETA); an order whose prediction slips past the promised date is automatically marked "at risk."
- **Internal lead-time ticker** — a separate, internal-only indicator of how long a line is genuinely likely to take, resolved from a supplier's own stated lead time or product-availability data (pasted in, or uploaded as a CSV against SKUs), with manual override always available and never silently overwritten by a later automatic recalculation.
- **Customer's own PO/reference number** — recorded separately from the business's own internal PO number to its supplier, since most customers look their order up by their own reference, not the internal one.
- **ERP sales-order sync** — reads sales orders from the business's ERP system on a schedule so staff stop re-typing orders it already has. Read-only — the ERP stays the system of record, nothing is ever written back to it. Purchase orders are not synced this way, since the ERP has no concept of which supplier fulfils a line or whether it ships direct — that judgement call stays with staff.

### 5.2 Carrier Tracking

- **Live tracking for major carriers with public, documented APIs** — connect an API key and it works, against a genuinely public and documented interface.
- **Tracking for carriers without open developer documentation** — built as best-effort, defensive reconstructions (a wrong field degrades gracefully rather than breaking), clearly marked as needing a correction pass once each carrier account exists and its real API responses can be checked.
- **Automatic polling** — status, location history and estimated delivery kept current on a schedule, with sensible back-off if a carrier's API is erroring.
- **Carrier connections screen** — shows which carriers are connected and currently healthy, with the reason behind any problem, using the same adapter-health pattern described in section 9.

### 5.3 Customs & International Shipments

- **Automatic international detection** — a shipment is flagged as international from its delivery country, with any ambiguous domestic-to-territory movement (e.g. a shipment from the mainland to an island territory that's politically domestic but practically customs-relevant) deliberately left for a human to confirm rather than guessed at by default.
- **Customs status indicator** — a red/amber/green status per international shipment, read from carrier tracking scans wherever a carrier's own events actually indicate a customs stage. No carrier publishes a dedicated customs code, so this has to be inferred from each event's own wording, and deliberately degrades to "unknown" rather than guessing when it can't tell.
- **Manual customs classification** — staff can set or correct a shipment's customs status directly; HS code, country of origin and dangerous-goods detail can be recorded per order line.
- **Customs document checklist** — tracks which customs documents an international shipment needs and which have actually been received.
- **Customs registration numbers & a customs-attention filter** — the business's own and a customer's customs registration number (e.g. an EORI-equivalent) can both be recorded; the Orders screen filters straight to anything currently needing customs attention.

### 5.4 Delivery Exceptions & Non-Conformance Tracking

- **Three ways one gets raised** — a customer reporting a problem from their own portal, a carrier delivery exception (returned, damaged, lost) drafting one automatically, or a staff member raising one directly on an order line.
- **Structured categories, triaged through to resolution** — damaged, short/missing, wrong item, not received, late, faulty/dead-on-arrival, or other — tracked from raised through triage, to whoever it's currently waiting on (supplier, carrier or customer), to resolved and closed.
- **Resolution tracking** — replacement (linked to a new order line), credit, return/RMA, refund, or no action, recorded against each one once resolved.
- **Claim-window awareness** — a carrier-specific claim-submission deadline is tracked per case, with its own red/amber/green health so a claim window never quietly expires unnoticed.
- **Automatic escalation** — the same amber → red → "needs attention" escalation used for supplier chases applies while a case sits waiting on someone, so an ignored one surfaces on its own.
- **Feed & reporting integration** — every raise and status change appears in the unified updates feed (see 5.6); reporting shows a non-conformance rate per supplier and per carrier.
- **Customer-safe by design** — a customer sees only their own report's category, date and status; root cause, internal owner, claim deadline and resolution detail are structurally invisible to them, the same masking discipline as the rest of the portal.

### 5.5 Customer Portal & Communication

- **Authenticated customer dashboard** — a customer can create a login and see every order for their company in one place, with spend summaries by currency.
- **No-login tracking links** — a link scoped to one specific order (revocable, can be set to expire) or a standing link covering a customer's whole order history, for sharing with anyone who doesn't need — or want — an account.
- **Report a problem** — a customer can raise a delivery exception directly from their own order view, from any portal surface; see 5.4.
- **Two-way order messaging** — a customer can ask a question or keep an ongoing conversation going about a specific order, from any portal surface. Any member of staff can reply directly from the order screen; the assigned rep (or, if unassigned, a fallback role) is notified the moment a customer writes in.
- **Automatic leak protection on every reply** — a staff reply is checked against the business's real supplier names and PO numbers before it can be sent; if it mentions one, it's blocked with an explanation rather than going out.
- **Customer notification preferences** — each customer chooses how much they hear, automatically, without needing to ask: everything, key milestones (the default), problems only, or nothing except replies to their own messages — with the option to fine-tune individual update types beyond whichever level they pick. A link to change this sits in every email they get.
- **One daily summary option** — a customer can opt into a single rolled-up daily email instead of separate ones for each update; genuine problems and replies to their own messages still come through immediately either way.
- **Anti-spam protections built in** — a delivery-date change only notifies a customer once it's moved by a meaningful amount (configurable) or crosses their promised date; routine updates on the same order are capped to no more than one every few hours (also configurable), with anything held back folded into the next update rather than simply dropped.
- **Structural masking** — every customer-facing screen and email is built from a separate, deliberately narrow version of the order data that has no field for a supplier name, PO number or internal price to even exist in; see section 2.

### 5.6 Internal Visibility & Reporting

- **Home screen** — a role-scoped landing page summarising what needs attention today.
- **Unified updates feed** — every event on every order — internal actions, supplier responses, carrier scans, customer messages, delivery-exception activity, notifications sent — in one place, filterable down to just the problems; also available scoped to a single order on that order's own page. Assembled at read time from the underlying tables rather than kept as a separate table, so it can never drift out of sync with the data it's showing.
- **Chases screen** — everything currently waiting on someone, across the whole pipeline (customer, sales, procurement, supplier, carrier), in one view.
- **Reporting** — business-wide figures, supplier reliability, how quickly each supplier responds to a PO, spend concentration by supplier, non-conformance rates by supplier and by carrier, and how well the automatic email-reading pipeline itself is performing.
- **Goods-in screen** — a simplified, focused view for warehouse staff checking deliveries in.

### 5.7 Team & Security

- **Role-based access** — every role in section 3, each seeing and able to do only what's appropriate to their job, enforced server-side and at the database layer.
- **Company settings** — chase escalation timing, delivery-date prediction defaults, what word is used for "supplier" when talking to a customer, whether a direct-ship carrier's name/tracking link is shown to a customer, and the organisation-wide defaults and hard limits for customer notifications.
- **Team management** — add and remove staff and reset a password.

### 5.8 Public-Facing

- **Lead-capture / interest sign-up page** — a simple public page for capturing interest from a prospective customer ahead of any self-serve sign-up or billing being built.

## 6. Integrations

Every external integration should be optional and additive — the product works without any of them connected, and switching one on should be a matter of adding credentials, not changing code. None of these should be configurable from inside the product itself; each is an account/admin-side task for whoever manages that system.

| Integration | Status | What it needs |
|---|---|---|
| Database, authentication & hosting | **Foundation** | A Postgres database with native row-level security used as the actual multi-tenancy boundary (not just an application-layer filter), with built-in authentication, and a serverless hosting platform with scheduled-job support for the polling/sync/digest jobs below. Needed before anything else. |
| Email sending & inbound reading | **Needs connection** | A business email account/API (e.g. a Microsoft 365 or Google Workspace account with an app registration, or a transactional-email provider for sending plus a separate inbound-parsing address) for sending supplier/customer emails and reading supplier replies automatically. Until connected, every outbound email is still generated correctly and logged internally; it just isn't delivered to a real inbox. *(Pack: Microsoft 365 chosen — see `integrations/microsoft365.md`.)* |
| ERP sales-order sync | **Needs connection** | An API/OAuth integration record in whatever ERP the business runs (e.g. NetSuite), read-only, to pull sales orders on a schedule. The business's ERP stays the system of record; nothing is ever written back to it. *(Pack: see `integrations/netsuite.md`.)* |
| Carrier tracking — major carriers with public APIs | **Needs connection** | Each needs its own API key/credentials from the carrier's developer portal. Well-documented, public APIs — low risk once a key is obtained. *(Pack: see `integrations/carrier-tracking.md`.)* |
| Carrier tracking — carriers without open developer documentation | **Built, needs verification** | These carriers don't publish open developer documentation, so integrations for them have to be built as best-effort reconstructions and verified against a real response once a business account exists with each one. |
| Carrier aggregator API | **Not started** | One integration covering several carriers at once, instead of building and maintaining each one separately. A genuine future simplification, not started. |

### A note on "needs connection"

Every feature that depends on one of the integrations above should still work in full on the product side — outbound emails generated and logged, supplier email reading built, the ERP sync logic built, carrier polling built — with only a real account/API key on the other end missing. Nothing should need to be re-built once an account is ready; only connected.

## 7. Roadmap — Not Yet Specified In Detail

Agreed in principle, scoped at a product level, but needing more design work before they're ready to build:

### 7.1 Supplier portal (data model first, no live function until switched on)

Groundwork so suppliers can eventually log in and see/confirm all their open purchase orders in one place, without switching anything on for the first release:

- A supplier-user account concept (supplier contacts with a login, linked to a supplier record, with a role within that supplier — e.g. viewer vs. confirmer).
- Row-level security scoping a supplier user to only their own supplier's purchase orders and lines, via a supplier-safe projection: PO lines, quantities, requested dates, delivery address for direct-ship lines. Never: customer sale price, margin, other suppliers' identities, internal notes, other suppliers' purchase orders.
- A plan for how the one-off, no-login PO confirmation link (5.1) maps onto this model — a login becomes a scoped, single-PO view of the same thing. That token should have real expiry and revocation from the start, not just single use.
- An org-level feature flag, default off, with no routes exposed while off.
- Tests for supplier isolation — supplier A can never read supplier B's rows, or any customer pricing — even before any UI uses it.

### 7.2 White-label customer portal (data model first, not used until switched on)

*(Pack: the branding resolver and per-org display name/logo are pulled forward into Phase 5 — see `00-decisions-and-conflicts.md` B5.)*

- Per-organisation branding: display name, logo, primary/accent colour, outbound email from-name and reply-to, an optional custom domain, and whether a "powered by" mark is shown.
- Every customer-facing page and email reading branding through one function, falling back to a product-level default brand.
- Theming via CSS variables so a colour change applies without touching individual components, with a contrast check on save so both light and dark modes stay legible.
- An org-level feature flag, default off, with the admin settings UI hidden while off.
- Custom domains: store the field only for a first release — actual domain routing is a later piece of work.

### 7.3 Other agreed-but-unscheduled items

- **Carrier aggregator API** — see section 6.
- **"Book a shipment with live carrier rates"** — discussed, comparable in size to the ERP/carrier work in section 6, not scoped yet.
- **Public API / webhooks** — undecided whether this is ever built. Worth deciding early regardless (see section 10) — keep the unified-feed event shape (5.6) clean and typed from day one, since any future public API or webhook would publish those same events.
- **SMS as a notification channel** — the notification system (5.5, 9.3) should be built with a channel interface that allows this to be added later; build the email channel first.
- **Time-saved / chase-avoided metric** — discussed as a reporting metric, tabled for now.
- **Reply-by-email from customers** — customer messaging (5.5) is portal-based only; replying to a notification email directly is out of scope for a first build.

## 8. Known Gaps & Limitations to Expect

A handful of deliberate scope decisions and genuine limitations worth deciding on consciously, rather than discovering by accident — kept visible here rather than glossed over:

- A delivery-date change notification should fire from the one place the system actually recalculates a predicted date; a couple of narrower trigger moments (an order first being placed; a shipment's customs status changing) are easy to miss wiring up and worth checking explicitly.
- Carriers without open developer documentation need their integrations treated as best-effort until checked against a real account — budget a short correction pass per carrier once an account exists.
- Automatic supplier-email reading is far simpler to build against a single-line purchase order than a genuinely multi-line one; decide up front whether multi-line confirmations need to be handled automatically or routed to a human to check which line was updated.
- Lead-time overrides being entered manually or via a pasted/uploaded CSV, rather than read automatically out of a supplier email, is a reasonable first-release scope — extending the email-reading pipeline to this is a deliberate later step, not an oversight.
- No carrier publishes a dedicated customs-status code — any customs status will have to be inferred from the wording of each carrier's own tracking events, and should deliberately read as "unknown" rather than guess when it can't tell. A customer-facing form for entering a customs registration number (vs. staff-only entry) is a reasonable thing to defer.
- Delivery-exception photo evidence needs real file-storage infrastructure; decide early whether that's in scope for a first release, since it affects the data model for the non-conformance records themselves.
- Date/working-time math should account for weekends at minimum; whether to also exclude public holidays (and for which territory/calendar) is worth deciding early rather than retrofitting.
- Supported currencies should be a short, explicit list to start with — designed so adding one is a small, deliberate change, not a redesign.
- Staff account lifecycle — deactivation/deletion, self-service email change with verification — is easy to under-scope on a first pass; see the recommendations in section 11.

## 9. Technical Architecture

A reference architecture for a developer team to build against, not a specific vendor mandate — the patterns matter more than the exact tool names.

### 9.1 Stack

- **A full-stack web framework with server-rendered pages and server-side mutations** (e.g. Next.js App Router) — keeps business logic server-side, avoids a separate API layer for internal screens.
- **A Postgres database with native row-level security**, used as the actual multi-tenancy boundary rather than just an application-layer filter (e.g. via Supabase, which can also supply authentication).
- **Serverless hosting with scheduled-job support** for the polling/sync/digest cron tasks described below (e.g. Vercel).
- **No AI/LLM dependency anywhere in the running product** — see section 2.

### 9.2 Data model

Grouped by domain. Every table should be reachable from an organisation either directly or by join — that's what row-level security scopes against (9.3).

- **Core / identity** — organisations; internal users (role-tagged); customers; customer login accounts; customer sites (multiple delivery locations per customer); contacts.
- **Orders & procurement** — sales orders; order lines (fulfilment route, HS code / country of origin / dangerous-goods detail); suppliers; purchase orders; lead-time observations.
- **Shipments & tracking** — shipments; shipment lines; tracking events; carrier connections (including per-carrier claim-window length); customs documents.
- **Chases & escalation** — chase events; per-organisation chase settings (amber/red/alert thresholds); chase notifications; chase updates.
- **Communication** — an append-only order-events history; a two-way order-messages thread; customer notification preferences; a customer notification log.
- **Delivery exceptions** — non-conformance records; non-conformance lines; non-conformance events.
- **Supporting** — email-extraction suggestions & supplier templates (for the automatic-reading pipeline); inbound-mailbox state; order tracking tokens; a public lead-capture table for the interest sign-up page.

Roughly 30–35 tables for the full core feature set in section 5 — not a large schema, but one where almost every table needs its own row-level-security policy written in the same migration that creates it.

*(Pack additions: `audit_log`, `attachments`, org branding fields, cron run log — see `00-decisions-and-conflicts.md`.)*

### 9.3 Architectural patterns

#### The masking layer

Define a parallel "raw" and "masked" type for anything that can reach a customer — e.g. a masked order-line type with no field for a supplier name to exist in, rather than the full internal type with a display rule that happens not to render it. Exactly one function is allowed to build the masked payload from the raw one. Cover it with tests that specifically try to leak sensitive content through, including scanning free text (a staff reply) for a real supplier name or PO number before it's allowed to be sent.

#### Four-layer separation, applied consistently

Pure logic (no I/O, fully unit-tested, with the current time passed in as a parameter rather than read from the system clock, so behaviour is deterministic in tests) → a data layer (reads and writes only, no business decisions) → server actions (check auth/role, then call the data layer and pure logic) → thin UI components that call those actions. Apply this to every feature, not just the complex ones — it's what makes the rule-based logic in section 2 actually testable.

#### RLS conventions

Write row-level-security policies as small reusable SQL helper functions (e.g. "current organisation", "current user is an elevated role", "current user can manage procurement") rather than repeating the same subquery in every policy. A table with no direct organisation column should be scoped by joining to whichever parent table does have one (e.g. order lines scoped via their parent sales order) — don't add a redundant organisation column just to simplify a policy.

#### Adapter + registry + health pattern

For anything with multiple interchangeable real-world implementations — carrier tracking, product-availability sourcing — define one interface, a registry that resolves the right implementation by name, and a uniform health-check return shape (a status level plus a human-readable reason) every implementation must provide. Surface that health as a settings-page status list and, where relevant, as a hover-tooltip indicator in context.

#### One escalation engine, reused everywhere

A single pure function computing an amber/red/alert level from "working hours elapsed since X" against a set of per-organisation thresholds, with a weekday-only time calculation. Reuse it unmodified for supplier chases, internal chases, and non-conformance waiting-states, rather than re-implementing "has this been ignored too long" per feature.

#### The unified feed

Assemble a single, typed, filterable list of "every event on every order" at read time, by querying each relevant source table in parallel and merging the results — rather than maintaining a separate feed table that writes have to remember to update. This guarantees the feed can never disagree with the data it's summarising.

#### The notification system

A single dispatch function that every other part of the system calls when something customer-relevant happens. It resolves the customer's chosen preference level, applies anti-bombarding throttling (a minimum gap between routine notifications on the same order, with anything held back folded into the next one rather than dropped) and a minimum-meaningful-change threshold (e.g. a delivery-date slip only notifies once it passes a configurable size, or crosses the promised date), then calls a channel abstraction — build the email channel first, but design the interface so SMS or another channel can be added later without touching the dispatch logic. Genuine problems and replies to a customer's own messages should always bypass the throttle.

#### Manual-override-is-sticky, applied wherever something recalculates automatically

Any background recalculation (predicted delivery date, internal lead-time estimate, customs classification) should check whether a human already set the value by hand and back off if so — build this check into the pure-logic layer itself (9.3, four-layer separation) so it can't be bypassed by a new caller.

#### Migration & testing discipline

- Every schema change is a sequential, numbered, hand-reviewed SQL migration file — never a hand-edited production database.
- Every table gets its row-level-security policies in the same migration that creates it, not added later.
- Every piece of pure business logic gets its own dedicated unit-test file, covering edge cases (boundary timestamps, empty/malformed input, the "I don't know" paths from section 2) rather than just the happy path.
- A change isn't considered finished until type-checking, linting, the full automated test suite and a production build all pass — ideally enforced by CI from day one rather than run by hand (see section 11).

## 10. Open Product Decisions to Settle Early

*(Pack: build defaults for every item below are set in `00-decisions-and-conflicts.md` section C.)*

Each of these can be built against a sensible default from day one, but settling the real answer early avoids rework later — several of these shape the data model directly (section 9.2), not just the UI:

- Where product-availability data ("in stock / available within N days") should come from long-term — an ERP field, a supplier feed, or manual entry. Default: manual/CSV entry only for a first release.
- The exact category list for a delivery exception / non-conformance. Default: damaged, short/missing, wrong item, not received, late, faulty/dead-on-arrival, other.
- Who receives a customer message when the assigned rep is unassigned or away. Default: a procurement/ops fallback role.
- Whether frontline sales staff should ever see supplier identity in internal views. Default: no — a rep-safe projection, separate from the customer-facing masked projection.
- Whether a domestic-to-territory movement should count as customs-relevant by default (see 5.3). Default: yes, configurable per organisation.
- Exact customer-facing wording for a customs hold. Default: a short, reassuring, non-alarming line — e.g. "Customs checks in progress — we're on it."
- Whether customers can report a delivery problem directly, or only via their account rep. Default: directly, from the portal.
- Per-carrier claim windows for damage/loss claims. Default: configurable per carrier connection, left blank until set rather than assumed.

## 11. Recommendations — Worth Adding From Day One

A ground-up build is the cheapest point to add the things below — none of them are in the core feature set above, but all of them are far more expensive to retrofit once the product is live and carrying real customer data.

- **A real audit trail, not just the activity feed** — the unified updates feed (5.6) is close to this but isn't designed as a tamper-evident record. A genuine audit log (who changed what, when, from what value to what value) matters for compliance and for resolving disputes about what actually happened on an order. *(Pack: moved into Phase 1.)*
- **Data retention & deletion from the start** — decide the account-deactivation/deletion flow for staff, and the retention/erasure policy for customer data, before launch rather than after — this is a real data-protection obligation in most jurisdictions, not an optional nicety.
- **Stronger staff authentication** — multi-factor authentication for internal accounts, especially any elevated role, given the system holds customer and commercial data.
- **Observability from day one** — structured error logging, alerting on failed background jobs (polling, sync, digest), and basic usage metrics. Wire this up before launch rather than retrofitting it once something has already failed silently in production.
- **Webhook-based carrier updates where available** — lower latency and lower API usage than scheduled polling (5.2, 9.3); worth checking per carrier during the build rather than defaulting every integration to polling.
- **A real file-storage layer, designed in from the start** — needed for delivery-exception photo evidence (section 8) and likely useful elsewhere (signed proof-of-delivery, supplier documents). Designing the schema with attachments in mind now avoids retrofitting it later.
- **A CI pipeline enforcing the testing discipline in 9.3**, not just following it by hand — type-check, lint, the full test suite and a production build gated on every change before it merges.
- **Settle the public-API/webhooks question early** (see 7.3) — even if the answer is "not yet," deciding it before the unified-feed and masking-layer shapes are finalised avoids a rework once a customer or partner actually asks for one.
- **Rate limiting on public-facing endpoints** — the no-login tracking links and the customer "report a problem" endpoint are reachable without authentication; add abuse protection on these from the start.
- **A tested backup/disaster-recovery plan**, decided and rehearsed before go-live, rather than assumed from a hosting provider's defaults.

## 12. Recommended Build Order

*(Pack: amended version in `CLAUDE.md` — audit log moves to Phase 1, branding resolver into Phase 5, marketing site can slot in any time after Phase 0.)*

A suggested phase sequence, ordered so each phase is genuinely usable on its own and sets up something the next phase reuses — rather than building every screen in parallel and integrating at the end. Section numbers below point back to the feature detail.

### Phase 0 — Foundations

- Framework, hosting, database with row-level security, and authentication (9.1) — nothing else can start until this is real.
- The organisations / internal users / roles schema (3, 9.2) and the role-based auth checks, since every later feature's access rules depend on this existing first.
- The four-layer convention and the migration/testing discipline (9.3) as project scaffolding — lint, type-check, test runner and build all wired up and passing on an empty project, before the first feature is written, not bolted on afterwards.
- Lock the name and colour palette before building the first customer-facing shell. *(Pack: done — COAST, see `02-design-handoff.md`.)*

### Phase 1 — Order & procurement backbone

- Core schema: customers, suppliers, sales orders, order lines, purchase orders (9.2).
- The internal dashboard shell — navigation, role-gated routes, the Orders screen (5.1).
- Manual order and PO creation, no automation yet. This alone is already a usable internal order tracker, and a safe point to get it in front of real staff for feedback.

### Phase 2 — Supplier communication loop

- Purchase-order emails with a no-login confirmation link (5.1).
- A paste-in version of supplier-email reading first (simplest to build and to test), before wiring up automatic inbound reading once an email account is connected (6).
- Discrepancy detection and the review queue (5.1).
- Build the reusable escalation engine (9.3) here, for the supplier chase workflow — it pays off again, unmodified, in Phases 5 and 7.

### Phase 3 — Shipment & carrier tracking

- Shipment schema (9.2), the adapter interface, one real carrier adapter plus a mock/stub adapter for local development and tests (5.2, 9.3).
- The polling job and connection-health reporting.
- Add remaining carriers incrementally behind the same interface — each one is additive, never a change to the core tracking logic.

### Phase 4 — Delivery-date prediction & lead-time tracking

- Build the prediction logic as pure, fully unit-tested functions before wiring it to any UI (9.3).
- The manual-override-is-sticky behaviour (2, 9.3) should be there from the first version of this, not added after an automatic recalculation first overwrites someone's manual entry in production.

### Phase 5 — Customer portal

- Build the masking layer — the raw/masked types and the one conversion function, with its leak tests (2, 9.3) — before writing a single customer-facing component. Everything customer-facing in this phase is built against the masked type only.
- No-login tracking links, then the authenticated login/dashboard (5.5).
- Two-way messaging, then notification preferences with anti-bombarding throttling and the digest option (5.5).

### Phase 6 — Internal visibility & reporting

- The unified updates feed (5.6, 9.3) — worth building once enough source tables and events already exist to make assembling them worthwhile, which is why it sits here rather than earlier.
- Reporting/metrics, the chases screen, and the home screen.

### Phase 7 — Customs & delivery exceptions

- Both of these reuse patterns already built in Phases 2–5 — the escalation engine, the masking layer, the unified feed — so they build faster here than if attempted earlier, even though they can feel like "core" functionality (5.3, 5.4).

### Phase 8 — Remaining integrations

- The read-only ERP sync job, and any carrier integrations still needing verification against a real account (6).

### Phase 9 — Hardening pass

- Work through section 11 in full: audit trail, data retention/deletion, staff MFA, observability, rate limiting on public endpoints, a tested backup/DR plan — before the first real customer data goes in, not after.

### Phase 10 — Roadmap items

- The supplier portal and white-label portal (7) — only once the core product is stable and one of them is actually wanted, not built speculatively ahead of demand.

## 13. Branding & Visual Identity — superseded

This section originally held starter prompts for choosing a name, palette, logo and login/loading treatment, plus a placeholder ink/amber/slate palette. **All of that is now decided** and lives in `02-design-handoff.md`, `design/tokens.css` and `design/logo/`. Do not use the old placeholder palette.

Two points from it still apply and are carried over:

- **Loading states:** the data-heavy internal screens (Orders, Reports) use skeleton loading for their own tables rather than a full-page spinner. Any global loading indicator should be minimal — e.g. a dot moving along a short dashed path — not a splash screen.
- **Login screen:** logo, one-line value statement and the form are the focus; no large competing illustration. (`SignIn.dc.html` already follows this.)

Trademark clearance for the name is an owner task — see `00-decisions-and-conflicts.md` section D.

## 14. A Few More Things Worth Deciding Before Kickoff

*(Pack: build defaults for each are in `00-decisions-and-conflicts.md` section C.)*

Beyond the feature set and recommendations already covered, these are genuinely separate questions — worth settling consciously rather than defaulting into an answer by accident:

- **Internally-operated tool vs. multi-tenant product sold to others** — the architecture throughout this specification (organisation-scoped data, row-level security, a public lead-capture page) supports either, but the two paths diverge sharply on everything downstream: self-serve account creation, subscription billing, usage limits, and a proper onboarding flow are only needed if this will be sold to multiple unrelated businesses rather than run for one. Decide this explicitly — it isn't implied by anything already specified.
- **Legal & policy documents** — a Terms of Service, a Privacy Policy, and cookie consent on any public marketing page; if this will be sold to other businesses whose own customers' data flows through it, a Data Processing Agreement template as well. None of this is a feature to build, but all of it needs to exist before real customer data goes in.
- **Accessibility target** — not specified anywhere above. Pick an explicit standard (e.g. WCAG 2.1 AA) up front, especially for the customer-facing portal, rather than discovering the gap in an audit later.
- **Mobile & responsive scope** — goods-in staff checking a delivery, and customers checking tracking, are both plausible phone users; the internal dense-data screens (Orders, Reports) are less obviously mobile use cases. Decide which surfaces need to be genuinely responsive rather than assuming either "all of it" or "none of it."
- **Environments & release process** — separate development, staging and production environments, a way to seed realistic demo data into a fresh environment (useful for onboarding a new developer as much as for demos), and a defined release process. This complements the CI recommendation in section 11, but is about environment topology rather than test gating, and is easy to leave implicit until it causes a production incident.
- **Interface language** — multi-currency is in the core feature set (5.1), but the interface itself is assumed English-only throughout. Worth stating explicitly if that's a real constraint for the markets this will operate in, since retrofitting translation after the fact touches almost every component.
