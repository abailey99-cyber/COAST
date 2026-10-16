# NetSuite integration — what's needed to build it

> **Changed by the pilot readiness plan (Task 2, 16 October 2026).** Each
> organisation now connects its **own** account in COAST under
> **Settings → Integrations**; the secrets are encrypted per organisation
> and are no longer environment variables. Where this guide says "set X as
> an environment variable", enter the same value in that organisation's
> Integrations form instead. NetSuite's machine-to-machine sign-in needs the account ID, integration client ID, certificate ID, signing method and private key (no client secret).


> **Pack note for Claude Code:** read-only Sales Order sync (spec §5.1, §6),
> OAuth 2.0 Client Credentials, SuiteQL. Environment variables:
> `NETSUITE_ACCOUNT_ID`, `NETSUITE_CLIENT_ID`, `NETSUITE_CLIENT_SECRET`,
> plus whatever the Client Credentials (M2M) flow needs for the certificate
> mapping — `NETSUITE_CERTIFICATE_ID` and `NETSUITE_PRIVATE_KEY` — confirm
> against Oracle's current docs when you build it and keep `.env.example`
> in step. Set `NETSUITE_ENV=sandbox|production`. Endpoint:
> `/api/cron/netsuite-sync`, guarded by `CRON_SECRET`. Every synced line lands
> as **from stock**; never create POs; never write back. Mark the SuiteQL query
> `// UNVERIFIED:` until tested against the real account. Store the
> last-successful-run watermark so each run only pulls changed orders.

*For your NetSuite admin/IT. This is what needs enabled and created on the
NetSuite side before a sync can be built and tested against it — nothing
here can be done from the platform's own side, since it all happens
inside your NetSuite account.*

## What this integration is

A one-way, **read-only** sync: the platform periodically reads Sales
Orders from NetSuite and mirrors the relevant fields, so staff stop typing
orders in by hand. NetSuite stays the system of record for orders — the
platform never writes anything back to it.

**Purchase Orders should deliberately not be synced.** A purchase order in
the platform carries information a NetSuite sales order doesn't have any
concept of — which supplier is fulfilling a line, and whether it ships
direct to the customer or via the business's own warehouse. Guessing at
that from NetSuite data would risk creating a purchase order that was
never meant to exist, so every line synced in from NetSuite should start
as "from stock" (the simplest case — already in hand, nothing to chase)
and staff still make the call on anything that actually needs a supplier
PO, same as before. The sync removes re-typing the order; it doesn't
remove that judgement call.

## Why OAuth 2.0, not the older Token-Based Authentication

NetSuite has historically offered two ways to authenticate an
integration: Token-Based Authentication (TBA, based on OAuth 1.0) and
OAuth 2.0. Oracle's own 2026.1 release notes announced that **new TBA
integrations won't be supported from release 2027.1 onward** — so build
this on OAuth 2.0 (Client Credentials) from the start, to avoid redoing it
in a year.

## Setup steps (NetSuite admin)

1. **Enable the required features.** Setup → Company → Enable Features →
   SuiteCloud tab: turn on **SuiteTalk (Web Services)** and **OAuth 2.0**,
   if not already on.
2. **Create an Integration record.** Setup → Integration → Manage
   Integrations → New.
   - Name it something recognisable, e.g. "[Your Platform] Sync".
   - Under Authentication, enable **OAuth 2.0**, with the **Client
     Credentials** grant type (no user has to log in for this to work —
     it runs as a background service, not as a person).
   - Saving this shows a **Client ID** and **Client Secret** — the secret
     is shown **once only**, so save it securely straight away (a
     password manager, not a plain email).
3. **Create a dedicated, restricted role.** Don't reuse an admin role.
   Create a new role (Setup → Users/Roles → Manage Roles → New) with
   permission to **view only** (not create/edit) Sales Orders, Customers
   and Items, and nothing else. This limits what the integration can ever
   see or do, even if the credentials were ever compromised.
4. **Create (or designate) an integration/service user** assigned that
   restricted role, and map it to the Client Credentials grant on the
   Integration record from step 2.
5. **Note the Account ID** — found in the NetSuite URL (the part before
   `.app.netsuite.com`) or under Setup → Company → Company Information.

## What to hand to whoever's building the integration

- The **Account ID**
- The **Client ID** and **Client Secret** from step 2 (send these the way
  you'd send any password — not plain email if avoidable)
- Confirmation of which environment these belong to — see the note below

## Strongly recommended: test in a Sandbox first

If there's a NetSuite Sandbox account available, do all of the above
there first and build/test against Sandbox credentials, rather than
connecting straight to live/Production data. Once the sync is proven to
read the right fields correctly, switching it to Production is a
five-minute credential swap, not a rebuild.

## What gets read (subject to confirming the exact field setup)

**Sales Orders**: SO number, customer (name + internal ID), due/promise
date, and each line's item code, display name, quantity and rate. A
SuiteQL query against NetSuite's standard table/column names
(`transaction`, `transactionline`, `customer.entityid`,
`item.displayname`, `lastmodifieddate`) is a reasonable starting point,
not a guarantee — every NetSuite account customises some of this (custom
fields, saved searches, subsidiary structure), so the exact query will
need confirming once there's read access to test against the real
account.

## How the sync should run

Same polling approach as the email integration, for the same reason:
simpler and just as timely as a live push for something that isn't
second-to-second time-critical. Trigger it on a schedule from outside the
application, the same way as the inbound-email poll (see that guide),
pointed at a sync endpoint of your own naming. Every 15–30 minutes is a
sensible starting schedule. Each run should only pull orders NetSuite says
changed since the last successful run, so it stays cheap even on a
frequent schedule.

## What this integration should NOT do

- It shouldn't write anything back into NetSuite — read-only, one
  direction.
- It shouldn't sync Purchase Orders (see above) or automatically pull in
  old/historical Sales Orders — only orders changed from whenever it
  first goes live, unless a backfill is specifically requested.
- It shouldn't decide routing/supplier for any line — every synced line
  should land as "from stock" until staff say otherwise.
- It shouldn't replace NetSuite as the source of truth for orders — it
  should mirror what's needed for delivery visibility, nothing more.
