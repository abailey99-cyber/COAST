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
