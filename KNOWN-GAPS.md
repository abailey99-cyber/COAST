# Known gaps

Everything stubbed, best-effort, unverified or deliberately deferred
(CLAUDE.md non-negotiable 9). Updated at the end of every phase. Search the
code for `UNVERIFIED:` for the in-code markers.

_Last updated: end of Phase 0 — 14 October 2026._

## Not built yet (by design — later phases)

| Item | Where it shows | Arrives |
|---|---|---|
| Every staff screen except Home and Settings | Placeholder pages saying "Not built yet · Phase N" | Phases 1–7 |
| Home "what needs attention today" | Home shows a welcome and what's ready | Phase 6 |
| Track an order (code + postcode) | Sign-in "Track an order" tab says tracking isn't open yet | Phase 5 |
| Customer tracking page | `/track` says tracking isn't open yet | Phase 5 |
| Sign in to a customer account | Not shown on the sign-in page | Phase 5 |
| Marketing site (How it works, Integrations, Pricing, register interest) | Home is a one-section holding page; the header shows only "Sign in"; the footer shows only the copyright line. "Register interest" isn't linked anywhere until the form exists | Any time — separate slot |
| Privacy, Terms, Contact pages and cookie notice | Not linked | Marketing slot (wording is an owner task) |
| Team management (add, remove, deactivate, change role) | Settings → Team is a read-only list. New people are added with `npm run org:create` / by the admin script | Later phase |
| Carrier connections card in the sidebar | Not shown | Phase 3 |
| Review queue / Chases count badges | Not shown | Phases 2 and 6 |
| Audit log | — | Phase 1 (decisions B4) |
| Recording each scheduled-job run for health screens | `/api/cron/ping` only checks the secret | First real job, Phase 2/3 |
| Staff MFA, rate limiting on public endpoints, backups/DR | — | Phase 9 (Supabase applies its own auth rate limits meanwhile) |

## Limitations to know about

- **Settings → Connections shows configuration only.** "Healthy" means the
  credentials are set, not that the service has been reached. Live checks
  arrive with each integration.
- **Theme choice is remembered per browser** (a cookie), not per user
  account. Moving it into the user's profile is a small later change.
- **Password-reset emails use Supabase's built-in sender**, which only
  allows a few emails an hour and comes from a Supabase address. Fine for
  development; production needs custom SMTP (or Microsoft 365, Phase 8).
- **RLS tests run against the Supabase development project, not in CI.**
  `tests/rls/isolation.test.ts` signs in as the demo users through the real
  API. It skips itself when the database isn't configured, which includes CI
  for now. To run it in CI, add the dev project's keys and
  `DEMO_USER_PASSWORD` as GitHub secrets (or switch to a local Supabase via
  Docker and pgTAP).
- **New organisations are created by script only** (decisions C1 — no
  self-serve sign-up or billing in v1). Public sign-up is switched off in
  `supabase/config.toml`.
- **An admin can't edit their own staff row through the app** (so they can't
  lock themselves out). Another admin, or the admin script, does it.

## Decisions this phase relied on (DEFAULT — CONFIRM)

- **C1** Multi-tenant product, no billing yet — the schema is organisation-scoped from the start.
- **C4** Sales reps don't see supplier names or costs — built into `src/lib/logic/roles.ts`.
- **Procurement can't open Settings** — from the "Who sees what" table on the How it works page. Admin edits; Director views.
- **Director sees every section, including Goods-in**, read-only (B9 "sees everything").

## Open questions logged for later phases

- **Sales visibility** (Phase 1): the spec says reps see their own orders *and* everyone else's read-only. The website's "Who sees what" table says "Their orders". Needs a product-owner decision.
- **Tracking code format** (Phase 5): decisions B7 says the tracking code is the SO number, but the sign-in mockup shows a random-looking code (`K7Q-4M2-XP9`). A random code is much harder to guess than a sequential SO number. Recommendation: use a random code.
- **DHL free tier** (Phase 3): 250 calls/day covers only a handful of active DHL shipments at 15–30 minute polling. A daily call budget will prioritise; real volumes likely need DHL's paid tier.
- **Vercel Cron** (Phase 2): the free plan runs scheduled jobs once a day. The 5–15 minute jobs need Vercel Pro or GitHub Actions' scheduler.
