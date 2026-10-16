# Supplier replies by email — platform setup (founder)

Readiness plan Task 3. Two ways a customer's supplier replies reach COAST:

1. **Forwarding (default, every customer):** each organisation gets its own
   random address, e.g. `r-3f9c…@replies.<your domain>`, and forwards its
   purchasing mailbox to it. Forwarded replies are **always checked by a
   person** — forwarding hides who really sent them.
2. **Microsoft 365 (opt-in):** COAST reads the customer's mailbox itself
   and can see each sender's SPF, DKIM and DMARC results. Only then may a
   confirmed date apply itself (see "Auto-apply rules" below).

This page is what **you** set up once for all of COAST. What each customer's
IT admin does is in `microsoft365-onboarding.md`.

## A. Mailgun (forwarding addresses) — EU region

1. Sign up at Mailgun and choose the **EU** region (data stays in the EU).
2. Add a receiving domain you own, e.g. `replies.<your domain>`. Mailgun
   shows two **MX** records (`mxa.eu.mailgun.org`, `mxb.eu.mailgun.org`):
   add them at your DNS provider. Wait until Mailgun shows the domain as
   verified for receiving.
3. **Receiving → Create route**:
   - Expression type: *Match recipient*, recipient: `.*@replies.<your domain>`
   - Actions: *Forward* to `https://<your COAST site>/api/inbound/mailgun`,
     and tick *Stop*.
   - Priority 0.
4. **Settings → Webhooks / API security → HTTP webhook signing key**: copy it.
5. In Vercel (each environment, see `docs/environments.md`) set:
   - `INBOUND_EMAIL_DOMAIN` = `replies.<your domain>`
   - `MAILGUN_WEBHOOK_SIGNING_KEY` = the signing key
6. Check: Settings → Supplier replies by email no longer says the service
   isn't switched on. Make an address, forward a test email to it from the
   domain you entered, and it appears in the Review queue.

COAST refuses anything not signed with that key, older than 15 minutes, or
seen before; mail to an address that doesn't exist is refused without
saying more.

> UNVERIFIED: Mailgun's form fields and forwarded-mail headers are from its
> documentation; confirm with a real message in staging.

## B. COAST's Microsoft app (Microsoft 365 mode)

One app for all of COAST, used by every customer who opts in.

1. In **your own** Microsoft Entra admin centre: App registrations → New
   registration. Name `COAST`. Supported account types: **Accounts in any
   organizational directory (multitenant)**. Redirect URI (Web):
   `https://<your COAST site>/api/integrations/m365/consent` (add one per
   environment).
2. **Do not add Mail.Read or Mail.Send application permissions here.** Each
   customer grants mailbox access for one mailbox only, in their own
   Exchange, using RBAC for Applications. If the app also had tenant-wide
   mail permissions, the one-mailbox limit would have no effect.
3. Certificates & secrets → New client secret. Copy the value.
4. In Vercel set `M365_CLIENT_ID` (the Application (client) ID) and
   `M365_CLIENT_SECRET`. Set a reminder to renew the secret before it expires.
5. Turn on the **Inbound mailbox** schedule: it runs every 15 minutes once
   the `COAST_APP_URL` and `CRON_SECRET` repository secrets are set
   (`.github/workflows/inbound-mailbox.yml`).

> UNVERIFIED: consent, per-tenant sign-in and mailbox reading are built
> from Microsoft's documentation and need a test tenant in staging
> (readiness plan Task 3 "done when").

## Auto-apply rules (Microsoft 365 only)

A supplier's confirmed date applies itself only when **all** of these hold;
otherwise a person checks it in the Review queue:

- the email passed **SPF, DKIM and DMARC**;
- it came from the supplier's email address, or one listed under
  Suppliers → Other addresses;
- COAST has read at least **3** earlier answers from that supplier without
  them needing correcting;
- it doesn't mention a **price or quantity** (those always go to a person);
- the usual reading rules are certain (one PO, one line, one clear date).

When a date applies itself, the sales rep on each order (or procurement)
is emailed straight away with a one-click **Undo**, which puts the PO back
exactly as it was.
