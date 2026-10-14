# Known gaps

Everything stubbed, best-effort, unverified or deliberately deferred
(CLAUDE.md non-negotiable 9). Updated at the end of every phase. Search the
code for `UNVERIFIED:` for the in-code markers.

_Last updated: end of Phase 1 — 14 October 2026._

## Not built yet (by design — later phases)

| Item | Where it shows | Arrives |
|---|---|---|
| Review queue, Chases, Shipments, Goods-in, Updates, Metrics | Placeholder pages saying "Not built yet · Phase N" | Phases 2–7 |
| Home "what needs attention today" | Home shows a welcome and what's ready | Phase 6 |
| Track an order (tracking code) | Sign-in "Track an order" tab says tracking isn't open yet | Phase 5 |
| Customer tracking page | `/track` says tracking isn't open yet | Phase 5 |
| Sign in to a customer account | Not shown on the sign-in page | Phase 5 |
| Marketing site (How it works, Integrations, Pricing, register interest) | Home is a one-section holding page; the header shows only "Sign in"; the footer shows only the copyright line. "Register interest" isn't linked anywhere until the form exists | Any time — separate slot |
| Privacy, Terms, Contact pages and cookie notice | Not linked | Marketing slot (wording is an owner task) |
| Team management (add, remove, deactivate, change role) | Settings → Team shows each person and their access (individual access *is* editable). New people are added with `npm run org:create` / by the admin script | Later phase |
| Carrier connections card in the sidebar | Not shown | Phase 3 |
| Review queue / Chases count badges | Not shown | Phases 2 and 6 |
| Recording each scheduled-job run for health screens | `/api/cron/ping` only checks the secret | First real job, Phase 2/3 |
| Staff MFA, rate limiting on public endpoints, backups/DR | — | Phase 9 (Supabase applies its own auth rate limits meanwhile) |

## Limitations to know about

### Phase 1 (orders and procurement)

- **An order's SO number and a line's fulfilment route can't be edited.**
  Everything else can (Edit order). To change a route, cancel the line and add
  a new one. Delivered and cancelled lines are locked.
- **The Orders list shows the newest 500 orders**; search reaches older ones.
  The tiles are worked out from those 500.
- **"At risk" isn't tracked yet** (Phase 4, delivery-date prediction), and the
  mockup's "Auto-confirmed this week" tile is replaced by "Need a purchase
  order" until supplier email reading exists (Phase 2).
- **Raising a PO moves its lines to "Awaiting supplier" straight away**, even
  while the PO is a draft. From Phase 2 POs are emailed when raised, so the
  gap closes; until then the PO page reminds you to send it yourself.
- **POs aren't emailed** — staff send them and mark them sent/confirmed by hand
  (Phase 2; real sending needs Microsoft 365, Phase 8).
- **A PO for less than the full quantity doesn't track the remainder** — the
  line can't get a second PO for the rest yet.
- **No customer sites or contacts yet** — the delivery address is typed on each
  order. Customers are created by typing a new name on an order.
- **Only Sales and Sales manager staff appear as sales reps.**
- **Screens mention build phases** ("arrives in Phase 4") so it's clear what
  isn't built. These go as each phase lands.
- **Audit log detail:** the Settings view lists what changed (fields), not the
  old and new values. Anyone given "Audit log" can read the stored values
  through the database, including costs — only give it to people who may see
  costs. Changes made by admin scripts to child records (e.g. order lines)
  are stored without an organisation, so they don't appear in any
  organisation's log.

### Phase 0 (foundations)

- **Settings → Connections shows configuration only.** "Healthy" means the
  credentials are set, not that the service has been reached. Live checks
  arrive with each integration.
- **Theme choice is remembered per browser** (a cookie), not per user
  account. Moving it into the user's profile is a small later change.
- **Password-reset emails use Supabase's built-in sender**, which only
  allows a few emails an hour and comes from a Supabase address. Fine for
  development; production needs custom SMTP (or Microsoft 365, Phase 8).
- **Database security tests and signed-in browser tests run on your computer, not in CI.**
  `tests/rls/*.test.ts` (37 tests) and the signed-in browser tests
  (`tests/e2e/roles.spec.ts`, `orders.spec.ts`) sign in as the demo users
  against the Supabase development project. They skip themselves when the
  database isn't configured, which includes CI for now. To run them in CI,
  add the dev project's keys and `DEMO_USER_PASSWORD` as GitHub secrets (or
  switch to a local Supabase via Docker and pgTAP). All passed locally on
  14 October 2026.
- **Every new table must grant `service_role` in its own migration.** Newer
  Supabase projects don't grant API roles table access by default (found
  during setup; fixed for Phase 0 tables in migration 0002).
- **`supabase config push` can't update Storage settings on the free plan.**
  Answer "n" to the storage prompt. The sign-in settings push fine.
- **New organisations are created by script only** (decisions C1 — no
  self-serve sign-up or billing in v1). Public sign-up is switched off in
  `supabase/config.toml`.
- **An admin can't edit their own staff row through the app** (so they can't
  lock themselves out). Another admin, or the admin script, does it.

## Decided by the product owner (14 October 2026)

See docs/00-decisions-and-conflicts.md sections E and F. In short: who sees
what is set per company by its admins; sales see all orders, supplier names
and costs by default (and open on "My orders"); everyone can open Settings;
directors are view-only unless an admin allows more; a sales manager role
sets individual reps' access (E7); random tracking codes; billing deferred;
the audit log is written by the database itself (F1).

## Not yet built from those decisions

- **Sales manager teams** — a sales manager covers every sales rep in the company; separate teams per manager aren't built (E7).
- **Individual access isn't cleared on a role change** — if someone moves role, their individual changes stay and still apply on top of the new role. Team management (later) should offer to clear them.

## Open questions logged for later phases

- **The website's "Who sees what" table** (marketing slot) describes fixed
  roles. It needs rewording to say each company sets its own, with defaults.
- **Postcode on "Track an order"** (Phase 5): per decision E4 the code alone is
  enough; the mockup's postcode box will be left out unless wanted.
- **DHL free tier** (Phase 3): 250 calls/day covers only a handful of active DHL shipments at 15–30 minute polling. A daily call budget will prioritise; real volumes likely need DHL's paid tier.
- **Vercel Cron** (Phase 2): the free plan runs scheduled jobs once a day. The 5–15 minute jobs need Vercel Pro or GitHub Actions' scheduler.
