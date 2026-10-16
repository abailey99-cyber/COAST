# Connecting COAST to your Microsoft 365 mailbox — for your IT admin

COAST tracks your orders and reads your suppliers' replies about them. You
can either **forward** supplier replies to COAST (no IT work needed) or let
COAST **read one mailbox** directly through Microsoft 365. This pack covers
the second. It takes about 15 minutes.

**What COAST can access:** one mailbox you choose (e.g. your purchasing or
PO-confirmation mailbox) — read its mail and send POs from it. Nothing else
in your organisation. You can check and remove this at any time.

**Why bother:** reading the mailbox directly lets COAST see whether each
email genuinely came from your supplier (SPF, DKIM and DMARC). Only then can
a supplier's confirmed date update your orders automatically — and your
team is told every time, with a one-click undo. Prices and quantities are
always checked by a person.

## You'll need

- A **Global Administrator** (or Privileged Role Administrator) to grant
  consent, and an **Exchange Administrator** for step 3.
- Your **tenant ID** (Entra admin centre → Overview → Tenant ID).
- The **mailbox address** COAST should read.

## 1. In COAST

An admin of your COAST account: **Settings → Integrations → Microsoft 365
mailbox → Connect**, enter the tenant ID and mailbox, and save.

## 2. Grant consent (Microsoft 365 admin)

In COAST: **Settings → Supplier replies by email → Give COAST access in
Microsoft 365**. You'll go to Microsoft's sign-in page; sign in as a Global
Administrator and accept. Microsoft sends you back to COAST, which shows
"Consent granted".

This adds COAST to your **Enterprise applications** — it does **not** give
COAST access to any mailbox yet. That's step 3.

## 3. Limit COAST to the one mailbox (Exchange admin)

COAST shows the exact commands under **Settings → Supplier replies by email
→ Limit COAST to that one mailbox**, with your mailbox filled in. In short,
in Exchange Online PowerShell:

```powershell
Connect-ExchangeOnline
New-ServicePrincipal -AppId '<COAST app ID>' -ObjectId '<Object ID>' -DisplayName 'COAST'
New-ManagementScope -Name 'COAST purchasing mailbox' -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'po@yourcompany.co.uk'"
New-ManagementRoleAssignment -App '<COAST app ID>' -Role 'Application Mail.Read' -CustomResourceScope 'COAST purchasing mailbox'
New-ManagementRoleAssignment -App '<COAST app ID>' -Role 'Application Mail.Send' -CustomResourceScope 'COAST purchasing mailbox'
Test-ServicePrincipalAuthorization -Identity '<COAST app ID>' -Resource 'po@yourcompany.co.uk'
```

The **Object ID** is in Entra admin centre → **Enterprise applications** →
COAST → Overview (not App registrations, which shows a different ID). The
last command should show `InScope True` for the mailbox; try it with another
mailbox and it should show `False`.

This uses Exchange Online **RBAC for Applications**, which Microsoft
documents as the replacement for Application Access Policies. Don't also
grant COAST tenant-wide `Mail.Read` in Entra — permissions from both add
together, and the limit would no longer apply.
(Microsoft Learn: "Role Based Access Control for Applications in Exchange Online".)

Changes can take 30 minutes to 2 hours to take effect.

## 4. Check it's working

COAST reads the mailbox every 15 minutes, and only mail that arrives
**after** consent. Send a test reply mentioning a PO number; it appears on
that PO in COAST.

## Removing COAST's access

Any of these stops it straight away (the first is enough):

1. In COAST: Settings → Integrations → Microsoft 365 mailbox → **Disconnect**.
2. In Exchange Online PowerShell:
   `Get-ManagementRoleAssignment -RoleAssignee '<COAST app ID>' | Remove-ManagementRoleAssignment`
3. In Entra admin centre → Enterprise applications → COAST → **Delete**
   (also removes it from Exchange).

## Questions your security team may ask

- **Where is data stored?** In the EU (Ireland). Emails COAST reads are kept
  with the order they're about.
- **Does COAST keep a password for our tenant?** No. COAST's own app signs
  in to your tenant with COAST's credentials, and only has what you granted
  in step 3.
- **Can COAST read other mailboxes?** No — step 3 limits it to one, and the
  test command proves it.
