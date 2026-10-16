# Pilot readiness plan (product owner, 16 October 2026)

Six tasks that take COAST from "works for one company" to ready for any
number of paying organisations. Decisions and adjustments are in
`docs/00-decisions-and-conflicts.md` section N. Work in this order, stopping
for review after each:

1. Task 1 — website truth pass
2. Task 5 Part A — environments, blocking CI, service-role confinement, cross-tenant harness
3. Task 2 — per-tenant encrypted credentials
4. Task 3 — two inbound email modes
5. Task 4 — aggregator tracking
6. Task 5 Part B — MFA, rate limiting, tokens, logging, alerting, restore, leak guard
7. Task 6 — data protection and pilot support

Then Phase 7b (Branches) and 7c (Projects) — `docs/03-branches-and-projects.md`.

**Scale:** plan for an unlimited number of organisations. Nothing may assume a
fixed number of tenants (no shared platform quotas, no per-tenant env vars).

A task is done when: the plan was approved; migrations carry their RLS; tests
cover edge cases and cross-tenant access; CI is green; the specification and
setup guides are updated; and the summary lists anything the founder must do
outside the code.

## Task 1: Website truth pass
- Every integration status pill (Live, Beta, In development, Planned) comes from one config file. Every carrier defaults to "In development" until the founder marks it verified against a real account.
- Integrations page: supplier email reading "Live (paste-in)"; Microsoft 365 and NetSuite "In development"; the carrier aggregator "In development".
- Pricing page: the three plans go behind a flag, with a "Founding partner programme — register interest" block in their place. Add a truthful card about the activity history on every order. (Section N1: the audit-trail claim stays, worded exactly, because the audit log exists.)
- Any ROI or time-saved figure is labelled illustrative.
- Masking wording: "Supplier details are masked everywhere in COAST", with a note that carrier labels and carrier tracking pages are outside COAST's control.
- "Show direct-ship carrier name and tracking link to customer" is off for new and existing organisations (migration).

Done when: a test fails the build if a page shows "Live" for an integration not marked verified; existing organisations have the direct-ship carrier setting off.

## Task 2: Per-tenant encrypted credentials
- Credential store per organisation: provider (microsoft365, netsuite, carrier name), credential kind, encrypted payload, key version, status, created by, rotated at, last used at. RLS in the same migration: only that organisation's Admin can create, rotate or delete; nobody reads the ciphertext through the normal client.
- Encryption: application-layer AES-256-GCM, master key from the hosting environment, per-record key versioning (section N3).
- Decryption in one server-only module. Decrypted values never reach the browser or logs, and live in memory only for the call that needs them.
- One resolver, `getIntegrationCredentials(orgId, provider)`, replaces every direct read of integration environment variables. Platform-level variables remain only for what COAST itself owns (tracking aggregator account, multi-tenant Microsoft app, inbound email provider).
- Per-organisation NetSuite configuration: account ID plus OAuth 2.0 machine-to-machine credentials (check whether NetSuite's client-credentials flow needs a certificate and private key; mark UNVERIFIED if unclear).
- Settings → Integrations per organisation: connect, rotate, disconnect, adapter health and reason.
- A security event for every create, rotate, delete and failed decryption.

Done when: no integration code reads customer-specific credentials from env vars; unit tests cover round-trip, rotation, wrong key and corrupted payload; cross-tenant tests prove org A (user or job) can't read, use or overwrite org B's credentials; a log-scan test finds no decrypted secret in logs.

## Task 3: Two inbound email modes
**Mode 1 — forwarding address (default).** Each organisation gets a unique, hard-to-guess inbound address on a COAST domain via an inbound email provider (propose one). The customer forwards supplier replies there; outgoing PO emails carry a PO reference for matching. Forwarded mail always goes to the review queue, never auto-applies (forwarding breaks sender authentication). Reject or quarantine mail to an organisation's address that didn't come from its own forwarding domain.

**Mode 2 — Microsoft 365 connection (opt-in).** Multi-tenant Entra app; each customer's admin grants consent via the admin-consent URL; COAST stores the tenant ID and mailbox in the credential store. Tokens per tenant via client credentials, never shared or cached across tenants. Scope to the one mailbox with Exchange Online RBAC for Applications (replacing Application Access Policies); generate the customer's PowerShell from their details. Turn the M365 setup guide into an IT-admin onboarding pack (consent, scoping, revoking).

**Auto-apply (Mode 2 only).** A confirmed date applies itself only when SPF, DKIM and DMARC all pass, the sender is a known contact for that supplier, and the supplier's template is proven. Never auto-apply a price or quantity change. Notify the assigned staff member when a date moves automatically, with one-click undo.

Done when: both modes work end to end in staging with a test tenant; unit tests cover every auto-apply rule (spoofed sender, DMARC fail, unknown sender, forwarded message); cross-tenant tests prove mail to org A's address can never attach to org B's PO.

## Task 4: Aggregator tracking
Tracking moves to one aggregator priced per shipment (DHL's free tier covers ~3 live shipments platform-wide; per-call pricing loses money). The founder chooses the aggregator; the choice is configuration.
- Aggregator adapter behind the existing interface, plus a mock. Provider-specific code in one module.
- Register each tracking number once; updates by signed webhook (reject unsigned). Otherwise adaptive polling: more often near the predicted date, backing off when quiet, stopping when delivered.
- Per-organisation monthly tracking-cost counter, capped at 5% of that organisation's plan price. Near the cap, slow polling and alert the founder; never silently stop.
- Map aggregator carrier codes and statuses onto COAST's; anything unmapped is "unknown". Reuse customs inference.
- Freeze DPD, Royal Mail/Parcelforce, Evri and Yodel direct adapters: flagged off, hidden, still UNVERIFIED.
- DHL, FedEx and UPS direct adapters only for organisations bringing their own account through the credential store. UPS direct disabled by default (UK UPS API terms restrict intermediary/multi-shipper use without written consent).
- Aggregator health via the adapter-health pattern on Carrier connections.

Done when: a staging shipment gets live updates by webhook (or the mock); unit tests cover status mapping, unmapped statuses, duplicate and out-of-order events, bad signature and the cost cap; no code polls a direct carrier API with a shared platform key.

## Task 5: Security hardening for the pilot
**Part A (before Task 2).** Separate development, staging and production (separate database projects and hosting environments); production secrets only in the hosting provider. Blocking CI on every pull request: typecheck, lint, tests, build, secret scanning, dependency audit; protect main. Service-role key confined to one server-only module, enforced by lint; every service-role query takes an explicit organisation ID. A cross-tenant harness: two organisations with every role, every read and write on every table as A against B, through RLS and background jobs; every new table must join it.

**Part B (after Task 4).** Staff MFA (TOTP) for every internal role. Rate limiting and lockout on every public route (sign-in, tracker, tracking links, supplier link, report-a-problem). Supplier tokens hashed at rest, configurable expiry (default 30 days), revocable, landing page with a "Confirm" button so scanners don't consume them. Security-event logging (sign-ins, failures, MFA, role, credential, token revocations). Alerts when any background job fails. Point-in-time backups, a restore runbook, one timed restore into staging. Stronger leak guard (case, whitespace, punctuation, company-suffix variants, PO patterns). Confirm UK/EU hosting region.

Done when: CI blocks a failing PR or one with a test secret; the harness covers every table; tests cover token expiry, revocation, scanner pre-fetch, lockout and leak-guard variants; a restore is documented.

## Task 6: Data protection and pilot support
- Admin data export: all organisation data, CSV per table, zipped.
- Find, export and delete/anonymise a person by email across every table, keeping order history intact.
- Configurable retention per organisation for contact details and message bodies on closed orders, by scheduled job with a dry-run report first.
- Placeholder privacy notice and sub-processor pages; cookie banner with non-essential cookies off by default.
- Order metering: one sales order counted once in the calendar month it was created or synced. Monthly count per organisation shown to Admins. No billing yet.
- Demo seed script: realistic, entirely fictional data for a fresh staging environment.

Done when: tests cover the person lookup across every personal-data table, the retention dry run and execution, and metering edge cases (synced twice, created at midnight on the last day of the month); the seed builds a working demo organisation from an empty database.
