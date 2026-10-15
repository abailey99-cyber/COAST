# Known gaps

Everything stubbed, best-effort, unverified or deliberately deferred
(CLAUDE.md non-negotiable 9). Updated at the end of every phase. Search the
code for `UNVERIFIED:` for the in-code markers.

_Last updated: end of Phase 6 — 14 October 2026._

## Not built yet (by design — later phases)

| Item | Where it shows | Arrives |
|---|---|---|
| Marketing site (How it works, Integrations, Pricing, register interest) | Home is a one-section holding page; the header shows only "Sign in"; the footer shows only the copyright line. "Register interest" isn't linked anywhere until the form exists | Any time — separate slot |
| Privacy, Terms, Contact pages and cookie notice | Not linked | Marketing slot (wording is an owner task) |
| Team management (add, remove, deactivate, change role) | Settings → Team shows each person and their access (individual access *is* editable). New people are added with `npm run org:create` / by the admin script | Later phase |
| Uploading customs documents themselves (PDFs) | The checklist records what's arrived; the files live wherever they do today | Later — photo storage is ready to extend |
| Staff MFA, rate limiting on public endpoints, backups/DR | — | Phase 9 (Supabase applies its own auth rate limits meanwhile) |

## Limitations to know about

### Phase 7 (delivery problems and customs)

- **Photos are shrunk in the browser** to at most 2000px and sent as JPEG,
  because a request can carry about 4 MB (Vercel's limit). Up to 5 per
  problem, 10 MB each before shrinking; the server checks each file's real
  type from its first bytes (JPEG, PNG, WebP only). An iPhone HEIC photo is
  converted where the browser can read it (Safari can) and refused otherwise.
  // UNVERIFIED: not yet tried on a real phone camera.
- **Photo files stay in Storage when an order is deleted.** Their records go
  (migration 0022); removing the files is part of Phase 9 retention.
- **A customer only sees problems they reported themselves**, with
  customer-safe wording ("We're looking into it", "We're sorting it out",
  "We need something from you", "Sorted"). Problems raised by carriers,
  goods-in or staff stay internal; a replacement line does show on the order.
- **A replacement copies only the first affected line**, once. Anything more
  is added by editing the order.
- **Carrier claim deadlines** come from the carrier's claim window in Settings
  (blank until set). With no window there's no deadline unless someone types
  one in. Claims are submitted outside COAST; COAST records that it was done.
- **The customs checklist is a suggestion** worked out from the shipment and
  its lines (invoice and packing list always; export or import declaration;
  certificate of origin if goods were made abroad; dangerous goods note when
  noted). Staff change it per shipment. HS codes, origin and dangerous-goods
  detail are edited on the order line.
- **Inbound shipments** only show customs when someone marks them as crossing
  a border; COAST doesn't record where a supplier ships from yet.
- **Customer report emails to staff** go through the email channel, which logs
  rather than sends until Microsoft 365 is connected (Phase 8).
- **Rate limits** on reports: 10 per visitor per hour and 5 per order per day.
- **Tracking numbers in an emailed supplier reply** (Phase 8, when replies
  arrive by themselves) will need `create_shipment` to work for the system
  account; today it takes the organisation from the signed-in person, so only
  pasted-in replies add shipments. The confirmation link doesn't ask for them.

### Phase 6 (Home, Updates, Chases, Metrics, Goods-in)

- **Metrics cover the last 180 days** and are worked out each time the page
  opens (fine for now; large volumes will want stored daily figures). Where
  there isn't enough data, a figure says so rather than showing 0%.
- **"Delivered on time" needs a delivery date**: orders marked delivered by
  hand with no delivered shipment aren't measured.
- **Real lead times** are measured from the PO being sent to goods being
  checked in (warehouse) or the direct shipment being delivered. COAST shows
  them next to what the supplier claims; it doesn't yet feed them back into
  delivery-date predictions automatically.
- **Delivery-problem rates** (Phase 7) count problems per 100 delivered:
  per carrier against delivered shipments, per supplier against delivered
  order lines. Under 5 deliveries shows "Not enough data yet".
- **Goods-in staff can't see orders**; they work from a narrow "due in" list
  (SO number, customer, item, PO and supplier, expected date, parcels). A
  damaged, short or wrong delivery leaves the line waiting for good stock and
  opens a delivery problem (Phase 7); returns are tracked on the problem.
- **Chases lists** unsent and unconfirmed POs, open supplier and internal
  chases, supplier answers to review, unread customer messages, delivery
  problems, customs holds and shipments with no carrier. Sales-side waits
  ("waiting on the customer") aren't tracked yet.
- **The Updates feed** reads the order history the database writes on every
  change, so it can't drift. Carrier scans appear as status changes, not
  every single scan.
- **Home** shows what's overdue, at risk, waiting for review, due in, and
  recent problems — each only if your role can see that area.

### Phase 5 (customer page, messages, updates, accounts)

- **Customer emails are written and logged, not sent**, like PO emails, until
  Microsoft 365 is connected (Phase 8). Each order's Customer panel shows
  exactly what was written, held back or skipped, and why. Invitations show
  their set-password link once on screen so staff can pass it on.
- **Staff hear about customer messages on the Orders list and the order**
  ("● 1 new message"); the email to the rep (or procurement, with no rep) is
  logged, not sent. They also show on Home and the Chases screen.
- **One standing link for all of a customer's orders** (spec §5.5) isn't
  built; customer accounts cover it. **Tracking codes don't expire**; staff
  can issue a new one, which stops the old one at once.
- **Rate limits are simple counters** per visitor address (60 lookups and 15
  misses per 10 minutes; 20 messages an hour). Behind Vercel the address
  comes from the x-forwarded-for header. Full rate limiting is Phase 9.
- **Customers can create their own account with a tracking code**, or be
  invited from an order. Public sign-up in Supabase stays off; COAST makes
  the login itself. An account belongs to one business and sees only orders
  added to it with a tracking code (decision E4).
- **UNVERIFIED: a self-made account's email address isn't confirmed yet**
  (that needs real email, Phase 8). Low risk: the account only sees orders
  whose codes its owner holds, and password resets go to the real address.
- **One COAST account covers every business** (decision L1). Automatic adding
  happens only when a business vouches for the person; matching a confirmed
  email to the address a business holds waits for real email (Phase 8).
- **Register-interest leads are read with `npm run leads`** (or `-- --csv`);
  there's no screen for them yet, and no self-serve trial or billing (L3).
- **The account's "spend" is the order value at your prices**, by currency,
  for orders added to the account.
- **Customer email addresses are per order** (set by the customer on their
  page, or by staff). There's no customer contact book yet.
- **Notification wording is fixed English**; per-company email templates and
  the full branding settings (colours, custom domain) stay roadmap (B5).
- **"Report a problem" from the customer page** arrives with delivery
  exceptions (Phase 7). Customers can write in meanwhile.
- **Database access rules call their permission helpers once per row.** The
  audit log's rule now uses the faster once-per-query form (migration 0018);
  the rest should be converted the same way before real volumes (Phase 9).
- **Every view a customer sees is checked twice**: built only through the
  masking function, then scanned for every supplier name and this order's
  PO numbers; if anything slips through, the page refuses to show.

### Phase 4 (delivery dates, at risk, lead times)

- **Predictions are rules, not learning.** Each line's date comes from, in
  order: delivered → the carrier's estimate once it's heading to the
  customer → the supplier's confirmed date → its lead time (set by hand,
  then availability for its product code, then the supplier's typical lead
  time) → "Not known yet". The order is its slowest line. COAST doesn't yet
  learn from how late each supplier really is; lead-time observations and
  supplier lateness arrive with Metrics (Phase 6).
- **One line without any date makes the whole order "Not known yet"** (it
  can still be flagged at risk if another line is already too late).
- **At risk** means the latest likely date is after the promised date, or
  the promised date has passed without delivery. Orders without a promised
  date are never flagged.
- **Warehouse turnaround, delivery days and estimate width are one setting
  per company** (Settings → Delivery dates), not per customer, carrier or
  service level.
- **Bank holidays aren't counted out** of working days yet (decision B14).
- **Dates are kept fresh** whenever anything about an order changes, when
  someone opens it, and on every run of the 30-minute schedule (which must
  be switched on, see Phase 3). Without the schedule, an unopened order's
  estimate can be a few days stale.
- **The history notes only meaningful changes**: risk turning on or off,
  a new kind of date, or a date from a person, supplier or carrier moving.
  Estimates counted from today drift daily without a history entry.
- **Availability is one figure per product code**, not per supplier, and is
  pasted or uploaded by hand (decision C2); there's no supplier feed.
- **Customers see the prediction** on their tracking page (Phase 5): a single date only when it's confirmed, a range otherwise.

### Phase 3 (shipments and carrier tracking)

- **No carrier is connected yet, and none has been tested against a real
  account.** DHL, FedEx (and TNT through it), UPS and Royal Mail are built
  from each carrier's published documentation and marked `UNVERIFIED:` in
  code. Add a carrier's credentials (`.env.example`, docs/integrations/carrier-tracking.md)
  and watch Settings → Carrier connections after the first run. Royal Mail is
  shown as **beta**.
- **DPD, Evri and Yodel don't check anything yet.** They have no public
  tracking API, so COAST won't send a key to a guessed address. With a key
  set they show "Beta: … waits for their integration pack". Shipments with
  them are updated by hand.
- **The tracking schedule needs switching on.** It's a GitHub Actions job
  (`.github/workflows/tracking-poll.yml`, every 30 minutes) because Vercel's
  free plan only runs daily jobs. It does nothing until the repository secrets
  `COAST_APP_URL` and `CRON_SECRET` are set. GitHub pauses schedules on
  repositories with no activity for 60 days. Until then, "Check now" on a
  shipment works.
- **DHL's free tier is small**: 250 checks a day for the whole of COAST,
  one every 5 seconds. COAST spreads them over the day, checks moving
  parcels first, and keeps 10% back for "Check now". Busy use will need
  DHL's paid tier.
- **One tracking call per shipment.** FedEx can look up 30 numbers in one
  call; batching isn't built.
- **No carrier webhooks** (spec §11 recommends them where available).
  Polling only for now; DHL, FedEx and UPS all offer push notifications
  worth adding once accounts exist.
- **UPS gives scan times in local time with no time zone.** COAST stores them
  as UTC, so a UK scan can be an hour out in summer, and a scan abroad by
  more.
- **"Out for delivery" and customs status are read from the carrier's
  words**, because no carrier publishes a code for either. When nothing
  mentions customs, an international shipment says "Not known" rather than
  guessing. Staff can set either by hand; a hand-set value sticks until
  handed back.
- **Inbound shipments don't know where they come from**, so they're never
  marked international. Supplier countries arrive with customs (Phase 7).
- **Inbound deliveries stop at "In transit to us"**: goods-in confirming
  receipt arrives in Phase 6. Until then, move the line on by hand.
- **The test carrier** (tracking numbers starting `MOCK-`) invents tracking
  for development and tests. It's hidden when `COAST_ENV=production`.
- **A shipment is for one order.** One consignment covering several orders
  is added once per order.
- **Supplier links don't ask for a tracking number.** Tracking numbers in a
  pasted email become shipments when the answer is applied or accepted.
- **Every staff member can see each carrier's overall health and today's
  check count** (it's shared by every company on COAST). No company's
  shipments are visible to another.

### Phase 2 (supplier communication)

- **Emails aren't actually sent.** COAST writes every PO and chase email and
  logs it (PO page → Emails), and shows the confirmation link once so you can
  send it yourself. Real sending arrives with Microsoft 365 (Phase 8).
- **Supplier replies aren't picked up automatically** — paste them in on the
  PO page. Reading the shared mailbox arrives with Microsoft 365 (Phase 8).
- **No reusable per-supplier email templates yet** (spec §5.1: "a supplier's
  format can skip the review queue once proven"). Every non-certain read goes
  to review. Worth adding once real supplier emails show which formats repeat.
- **SKU mismatches aren't detected** from emails or links — the supplier
  can't change the product code on the link, and email product codes are too
  varied to compare reliably. Quantity, price, currency, date and "can't
  supply" are detected.
- **A partly-accepted answer leaves the PO "sent"** (e.g. one line can't be
  supplied). Staff then cancel or re-source that line by hand.
- **The public confirmation page has no rate limit yet** (Phase 9). Its codes
  are 256 random bits, so guessing one isn't practical.
- **Chasing a supplier makes a new link and revokes the old one**, so the link
  in the first email stops working after a chase. The page says so and points
  them to the newest email.
- **Escalation ignores bank holidays** (decisions B14) — the engine accepts a
  holiday list; it isn't filled in yet.
- **No notifications yet** — nobody is alerted when something turns red or a
  chase is raised; it shows on the PO, the order and the Review queue badge.
  Notifications arrive with Phase 5/6.
- **Accepting a review answer is slow-ish** (a dozen round trips to the hosted
  database, occasionally over 15 seconds in tests). Worth profiling in Phase 9.
- **The development project's sign-in limit is raised** to 120 per 5 minutes
  for the automated tests (`supabase/config.toml`). A production project
  should keep Supabase's default.

### Phase 1 (orders and procurement)

- **An order's SO number and a line's fulfilment route can't be edited.**
  Everything else can (Edit order). To change a route, cancel the line and add
  a new one. Delivered and cancelled lines are locked.
- **The Orders list shows the newest 500 orders**; search reaches older ones.
  The tiles are worked out from those 500.
- **The mockup's "Auto-confirmed this week" tile is replaced by "Need a
  purchase order"** until Metrics (Phase 6) can count it.
- **Raising a PO moves its lines to "Awaiting supplier" straight away**, even
  while the PO is still a draft waiting for "Send to supplier".
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
  `tests/rls/*.test.ts` (45 tests) and the signed-in browser tests
  (`roles`, `orders` and `supplier-loop` specs) sign in as the demo users
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
- **DHL free tier**: see Phase 3 above — handled with a daily budget; real volumes likely need DHL's paid tier.
- **Vercel Cron**: handled with a GitHub Actions schedule (Phase 3). Vercel Pro would also do.
