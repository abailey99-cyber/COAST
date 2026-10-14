# Live carrier tracking — what's needed to switch each carrier on

> **Pack note for Claude Code:** implement spec §5.2 / §9.3 (adapter +
> registry + health). One `CarrierAdapter` interface; a `mock` adapter for
> dev/tests; DHL first, then FedEx (TNT reuses FedEx credentials), UPS, then
> the best-effort four marked `// UNVERIFIED:` in code and "beta" in the UI.
> A carrier with no env vars reports `unconfigured` — never an error. One
> poll endpoint, `/api/cron/tracking-poll`, guarded by `CRON_SECRET`, covers
> every configured carrier and respects each one's rate limits (DHL: 250
> calls/day, ≤1 per 5 s — prioritise shipments not yet delivered and not
> polled recently). Back off on repeated errors. Customs status is inferred
> from event wording and falls back to `unknown`. Carrier delivery exceptions
> (returned/damaged/lost) draft a delivery-exception record (spec §5.4).
> Check each carrier for webhook support as you build it (spec §11).

*For whoever sets up hosting/environment variables for the platform. This
is what needs getting from each carrier before real tracking data can
flow in for it — nothing here can be done from inside the platform
itself, since these are all outside accounts it only ever reads from.*

## What this integration is

Call each carrier's own tracking API directly, on a schedule, and keep
every shipment's status, ETA and event history up to date automatically —
with zero code changes once credentials are in place, the same "add an
environment variable and it just works" pattern as the NetSuite and
Microsoft 365 integrations. A carrier-connections settings screen can show
which carriers are set up and whether they're currently working, with a
reason surfaced for any problem (see the adapter-health pattern in the
main specification).

Until a carrier's environment variables are set, nothing should break —
its shipments simply won't have live tracking data yet.

## Confidence varies a lot by carrier — read this before setting any of them up

**DHL, FedEx and UPS** are built against genuinely public, well-documented
developer APIs — the highest-confidence integrations of the group.

**DPD, Royal Mail/Parcelforce, TNT, Hermes/Evri and Yodel are different.**
None of them have an openly published, self-serve developer API the way
DHL/FedEx/UPS do — most only hand over real API documentation once a
business account already exists with them. Any connector built for these
ahead of having a real account should be treated as a best-effort
reconstruction of a plausible API shape, not verified against a real
response, and marked as such both in code and in the UI. Build them
defensively (a wrong field name should degrade to an empty result rather
than crashing), but expect to need a real correction pass, using that
carrier's actual API documentation, the first time one of these is
genuinely put into use.

## Getting a DHL API key

1. Go to **developer.dhl.com** and create a developer account (a business
   email is enough to start — a full DHL shipping account isn't required
   just to *track* shipments, though rates/limits differ if there is one).
2. Create a new "app"/project in the developer portal and add the
   **Shipment Tracking – Unified Tracking API** product to it.
3. The portal issues an **API key** straight away for this API (no
   separate secret, no OAuth login — it's a single key sent with every
   request).
4. Set that key as an environment variable, e.g.:
   ```
   DHL_API_KEY=<the key>
   ```

**A real limitation, not a bug:** DHL's public tracking API only reports a
shipment's status as one of five broad states (pre-transit / in transit /
delivered / a problem / unknown) — it doesn't distinguish "out for
delivery" or "held at customs" as their own status. It also has a modest
free-tier limit (250 calls/day, no more than 1 every 5 seconds) — build
the polling schedule to stay inside that automatically.

## Getting FedEx API access

1. Go to **developer.fedex.com** and create a developer account.
2. Create a new "project" and add the **Track API** to it.
3. The portal issues an **API Key (Client ID)** and **Secret Key (Client
   Secret)**.
4. Set both values as environment variables, e.g.:
   ```
   FEDEX_CLIENT_ID=<the API key / client id>
   FEDEX_CLIENT_SECRET=<the secret key / client secret>
   ```

FedEx's Track API can look up several tracking numbers in one call, so it
doesn't have DHL's "one call per shipment" pacing constraint.

## Getting UPS API access

1. Go to **developer.ups.com** and create a developer account.
2. Create a new app and add the **Tracking API** to it.
3. The portal issues a **Client ID** and **Client Secret**.
4. Set both values as environment variables, e.g.:
   ```
   UPS_CLIENT_ID=<the client id>
   UPS_CLIENT_SECRET=<the client secret>
   ```

Like DHL, UPS's Tracking API looks up one shipment per call.

## TNT

TNT Express was acquired by FedEx in 2016 and its tracking now runs
through FedEx's own systems in most markets, so TNT tracking can reuse
**the same FedEx client ID/secret as above** — nothing separate to set
up. If TNT tracking numbers don't resolve once FedEx is configured,
that's the first thing worth checking with FedEx directly (it may need an
extra note on the account for TNT-heritage numbers).

## DPD, Royal Mail/Parcelforce, Hermes/Evri, Yodel — need a real integration pack

These four don't have a public developer-portal signup the way the
carriers above do. Getting real API access means contacting the carrier
directly as a business customer and asking for their tracking API
integration documentation — what they send back may not match whatever
environment variable names are chosen below, in which case the
corresponding adapter needs a matching update, not just a config change:

```
DPD_API_KEY=<once DPD provides a real integration pack>
ROYAL_MAIL_CLIENT_ID=<Royal Mail Group's IBM API Connect client id>
ROYAL_MAIL_CLIENT_SECRET=<Royal Mail Group's IBM API Connect client secret>
HERMES_API_KEY=<once Evri provides a real integration pack>
YODEL_API_KEY=<once Yodel provides a real integration pack>
```

Royal Mail Group (which also covers Parcelforce tracking numbers) is the
one exception with a somewhat-public developer portal — worth checking
developer.royalmail.net/Royal-Mail-Group directly, since it's more likely
to be self-serve than the other three.

## Turning the polling schedule on

Getting credentials only makes tracking *possible* for that carrier —
something also needs to actually trigger a periodic check. That's a
scheduled HTTPS request from outside the application, protected by a long
random secret set as an environment variable (the same mechanism as the
inbound-email and NetSuite-sync polls — see those guides), pointed at a
tracking-poll endpoint of your own naming. One poll run should cover every
configured carrier — there's no need for a separate schedule per carrier.
Every 15–30 minutes is a sensible schedule.

## What this does NOT do (yet)

- It doesn't give any interface for entering per-customer/per-organisation
  carrier account numbers — each carrier has one set of credentials for
  the whole platform, set once as above.
- None of the eight carriers listed should be assumed to work against a
  real account until actually tested — see "Confidence varies a lot by
  carrier" above for which ones that matters most for.
