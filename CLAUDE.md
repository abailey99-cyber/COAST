# COAST — build brief for Claude Code

COAST (Centralised Order And Shipment Tracking) is a multi-tenant B2B
order-visibility platform: it follows every customer order from the purchase
order sent to a supplier, through confirmation and dispatch, to delivery at
the customer's door — and gives the customer an honest, self-service view of
it **without ever revealing who the supplier is**.

You are building it from scratch: the internal staff web app, the customer
tracking portal, the public marketing site, and the integrations — all in one
codebase. This file is the operating brief. The detail lives in `docs/` and
`design/`.

## Read these, in this order, before writing code

1. `docs/00-decisions-and-conflicts.md` — how the sources fit together, which
   wins on conflict, and the defaults for every open decision. **Overrides
   everything else where it speaks.**
2. `docs/01-build-specification.md` — what to build and how it behaves
   (features, data model, architecture patterns, build order).
3. `docs/02-design-handoff.md` — brand, logo, colour, type, components, and
   every designed screen with approved copy.
4. `design/tokens.css` — the design tokens as CSS variables.
   `design/mockups/README.md` — how to read the mockup files.
5. `docs/integrations/` — Microsoft 365, NetSuite and carrier tracking setup.
   Read the relevant one when you reach that phase.

Don't re-read everything every session — read what the current phase needs.

## Stack (decided)

- **Next.js** (App Router, TypeScript `strict`), server components + server
  actions. Route groups: `(marketing)`, `(app)` (staff), `(portal)` (customer),
  plus `app/api/cron/*` and `app/api/inbound/*`.
- **Supabase**: Postgres with row-level security as the tenancy boundary,
  Auth, Storage. Local dev via the Supabase CLI.
- **Vercel** for hosting and Cron.
- **Vitest** (pure logic), **Playwright** (critical flows), SQL tests for RLS.
- **Sora** via `next/font/google`; styling from `design/tokens.css` (CSS
  variables — Tailwind is fine if its theme maps to those variables).
- **No AI/LLM/ML dependency anywhere in the running product.** All automatic
  decisions are deterministic rules.

## Non-negotiables (spec §2 — hold these everywhere)

1. **Masking is structural.** Customer-facing code only ever receives
   dedicated masked types that have *no field* for supplier name, PO number,
   cost/price, internal notes or direct-ship origin address. Exactly one
   function converts raw → masked. Leak tests try to break it. Every staff
   reply to a customer is scanned for real supplier names and PO numbers and
   blocked if one appears. Sales reps get a separate rep-safe projection.
2. **Four layers, never skipped:** pure logic (no I/O, time passed in as a
   parameter, unit-tested) → data layer (reads/writes only) → server actions
   (auth + role check, then call down) → thin UI.
3. **Manual overrides are sticky.** Any automatic recalculation (predicted
   date, lead time, customs status) backs off if a human set the value. The
   check lives in the pure-logic layer.
4. **"I don't know" beats a guess.** Unknown/uncertain is an explicit state in
   the data and the UI. Uncertain dates are shown as ranges.
5. **Adapters + registry + health.** Carriers (and availability sources)
   implement one interface and report `{ status: 'ok'|'warn'|'error'|
   'unconfigured', reason: string }`. A missing credential means
   "unconfigured", never a crash.
6. **One escalation engine** (amber → red → alert from working hours elapsed
   vs. per-org thresholds), reused unmodified for supplier chases, internal
   chases and delivery exceptions.
7. **RLS on every table, in the same migration that creates it.** Use small
   SQL helper functions (`current_org_id()`, `is_elevated()`,
   `can_manage_procurement()`). Child tables scope via their parent; no
   redundant `org_id` columns just to simplify a policy.
8. **Numbered migrations only.** Never edit a database by hand.
9. **Disclose gaps.** Anything stubbed, best-effort or unverified is marked in
   code (`// UNVERIFIED:` with the reason) and in the UI, and listed in
   `KNOWN-GAPS.md` at the repo root.
10. **Never advertise anything as live unless it is** (handoff §8) — marketing
    status pills come from a config file (decisions B3).

## Build order

Follow spec §12, with the amendments in `docs/00-decisions-and-conflicts.md`:

| Phase | Scope | Notes |
|---|---|---|
| 0 | Scaffold, Supabase, auth, orgs/users/roles, CI, tokens, logo/favicon, app shell (dark/light) | Lint, typecheck, tests and build all green on an empty project first. Brand is already locked. |
| 1 | Core schema, Orders screen, manual order + PO creation, **audit log** | Audit log moved up from Phase 9 (B4). Build the Orders dashboard to match `App.dc.html`. |
| 2 | PO emails + no-login confirm link (with expiry + revocation), paste-in email reading, discrepancies, review queue, escalation engine, chases | Outbound email goes through a channel interface; until M365 is connected, emails are generated and logged, not sent. |
| 3 | Shipments, carrier adapter interface, mock adapter, DHL first, polling job, carrier connections screen | Respect DHL's 250 calls/day, ≤1 per 5s. Then FedEx (+TNT), UPS, then best-effort carriers marked UNVERIFIED. |
| 4 | Delivery-date prediction, at-risk flag, lead-time ticker | Pure functions first, sticky overrides from day one. |
| 5 | Masking layer + leak tests **first**, branding resolver, tracking links, track-by-code+postcode, customer page, customer accounts, messaging, notifications | Customer page matches `Customer.dc.html`. Sign-in matches `SignIn.dc.html`. |
| 6 | Unified feed, Home, Chases screen, Metrics/reporting, Goods-in | |
| 7 | Customs, delivery exceptions (+ photo attachments) | Reuses escalation, masking, feed. |
| 8 | M365 inbound/outbound live, NetSuite read-only sync | Follow `docs/integrations/`. |
| 9 | Hardening: MFA for staff, rate limiting, observability, retention/deletion, backup/DR | Spec §11. |
| — | Marketing site (`Website`, `HowItWorks`, `Integrations`, `Pricing`, `SignIn` mockups) | Can be built any time after Phase 0; it's static apart from the lead-capture form and status config. Good early win. |
| 10 | Roadmap (supplier portal, full white-label) | Only when asked. |

Each phase should be usable on its own. At the end of each phase: run the
full check suite, update `KNOWN-GAPS.md`, and give the product owner a short plain-English
summary of what now works, what's stubbed, and any **DEFAULT — CONFIRM**
decisions that phase relied on.

## Definition of done (every change)

`typecheck` · `lint` · `test` · `build` all pass (CI enforces it). New pure
logic has its own test file covering edge cases and unknown paths. New tables
have RLS + an isolation test (org A can't read org B). New customer-facing
data passes through the masking function. No secrets in code.

## Working conventions

- Environment variables only for credentials; keep `.env.example` complete
  and commented. Integration variable names are in `docs/integrations/`.
- Every integration is optional: the app runs fully with none configured.
- Seed data uses placeholders (`[Customer A]`, `SO-10421`) — no invented
  real-looking companies. Supplier names in seed data are obviously fake.
- UK English in all copy and UI; dates like "Thu 16 Oct"; currency with
  symbol (`£1,250.00`).
- Status is never colour alone: always "● On track".
- White text only on Tide Teal Deep `#1A7584`, never on Tide Teal `#1F8A9C`.
- Use the supplied logo SVGs from `design/logo/`; never redraw the mark.
- The product owner is not a developer. When you need a decision, ask one clear question
  with a recommended answer. Explain things in plain English.
