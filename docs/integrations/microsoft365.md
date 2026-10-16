# Microsoft 365 email integration — what's needed to build it

> **Changed by the pilot readiness plan (Task 2, 16 October 2026).** Each
> organisation now connects its **own** account in COAST under
> **Settings → Integrations**; the secrets are encrypted per organisation
> and are no longer environment variables. Where this guide says "set X as
> an environment variable", enter the same value in that organisation's
> Integrations form instead. COAST's own multi-tenant app (`M365_CLIENT_ID`, `M365_CLIENT_SECRET`) is the only part in the hosting settings; each organisation's tenant ID and mailbox are in its Integrations form. Task 3 turns this guide into an IT-admin onboarding pack.


> **Pack note for Claude Code:** this is the email channel for COAST (spec §6).
> Build against Microsoft Graph with the client-credentials flow. Environment
> variables: `M365_TENANT_ID`, `M365_CLIENT_ID`, `M365_CLIENT_SECRET`,
> `M365_MAILBOX` (the shared mailbox address). If any are missing, the email
> channel reports "unconfigured" and outbound emails are generated and logged
> but not sent. Inbound polling endpoint: `/api/cron/inbound-mail`, guarded by
> `CRON_SECRET`. Customer-facing emails must use the branding resolver
> (decisions B5) and the masked data types only.

*For whoever manages your business's Microsoft 365/Entra ID (Azure AD)
tenant. This is what needs setting up on the Microsoft 365 side before the
platform can send and receive real email through it — nothing here can be
done from the platform's own side, since it all happens inside your
Microsoft 365 admin centre.*

## What this integration is

The platform sends purchase-order confirmation emails to suppliers and
reads their replies back in, automatically. Rather than adding a separate
third-party email provider, this runs entirely through your existing
Microsoft 365 subscription via the Microsoft Graph API — no new vendor, no
new account for anyone to manage day to day.

It also sends any customer-facing tracking-link or notification emails the
platform generates.

## Setup steps (Microsoft 365/Entra admin)

1. **Create (or designate) a shared mailbox** for supplier confirmations,
   e.g. `po-confirm@yourdomain.com`. A **shared mailbox**, not a normal
   licensed user mailbox — it doesn't need its own paid licence, and no
   person needs to log into it directly; the platform reads and sends
   through it via the API.
2. **Register an application** in Entra ID (Azure AD) → App registrations
   → New registration.
   - Name it something recognisable, e.g. "[Your Platform] Email
     Integration".
   - Note the **Application (client) ID** and **Directory (tenant) ID**
     shown on the app's Overview page.
3. **Create a client secret.** Certificates & secrets → New client secret.
   The secret value is shown **once only** — save it securely straight
   away (a password manager, not a plain email).
4. **Grant API permissions.** API permissions → Add a permission →
   Microsoft Graph → **Application permissions** (not Delegated — this
   runs as a background service, nobody signs in):
   - `Mail.Send`
   - `Mail.Read`

   Then click **Grant admin consent** — these are high-privilege
   permissions (in principle they'd let an app send or read *any*
   mailbox in the tenant), which is exactly what the next step narrows
   down.
5. **Restrict the app to just the one mailbox**, using an Exchange
   Application Access Policy (this is the important security step — don't
   skip it). In Exchange Online PowerShell:
   ```powershell
   New-ApplicationAccessPolicy -AppId <client-id-from-step-2> `
     -PolicyScopeGroupId po-confirm@yourdomain.com `
     -AccessRight RestrictAccess `
     -Description "Restricted to PO confirmation mailbox"
   ```
   Without this step, the app's Mail.Send/Mail.Read permissions apply to
   **every mailbox in the tenant**, not just the one it needs.

## What to hand to whoever's building the integration

- **Tenant ID**, **Client ID**, **Client Secret** from steps 2–3 (send
  these the way you'd send any password — not plain email if avoidable)
- The **shared mailbox address** from step 1

## How the inbound side should work

Rather than a live push notification (a Microsoft Graph "subscription"),
poll the mailbox every few minutes for new messages. Graph's push
subscriptions for mail expire after about 3 days and need their own
renewal job to keep working — one more thing that can silently break —
and supplier acknowledgement emails aren't time-critical to the minute, so
polling is simpler and just as useful in practice.

The poll itself needs to be triggered on a schedule from outside the
application itself — most hosting platforms support a scheduled job
(a cron-style configuration, or a free scheduled-workflow feature) that
fires an authenticated HTTPS request at an inbound-mail-polling endpoint
on a regular interval, protected by a long random secret set as an
environment variable so nothing else can trigger it. Every 5–15 minutes is
a sensible starting schedule.

## What this does NOT do

- It doesn't touch any other mailbox in the tenant — the Application
  Access Policy in step 5 enforces that at the Microsoft 365 level, not
  just in application code.
- It doesn't read or send anything beyond the one shared mailbox
  configured for this purpose.
- It doesn't set up SPF/DKIM/DMARC — Microsoft 365 already handles that
  for mail sent through its own infrastructure, since this isn't a
  separate sending domain/provider.
