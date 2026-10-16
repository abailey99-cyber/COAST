# Where COAST uses the service role

The service-role client (`createSupabaseAdminClient`, `src/lib/supabase/admin.ts`)
**bypasses row-level security**. It's the most likely place for one
organisation's data to reach another, so every file that uses it is listed
here with how it stays inside one organisation. (Readiness plan Task 5A;
also the elevated-access checklist for Branches, `docs/03-branches-and-projects.md`
step 3.)

**Rules**

1. Only `src/lib/supabase/admin.ts` reads `SUPABASE_SERVICE_ROLE_KEY`, and
   only files under `src/server/` may create the client. ESLint enforces both.
2. Every use is scoped *before* the call by one of: a hashed link token, a
   tracking code, a signed-in customer's own account, `CRON_SECRET`, or the
   signed-in staff member's own (RLS) client having already read the same
   record. Admin-client writes take their organisation from that record or
   from the staff member, never from what the browser sent.
3. A file that starts using the client must be added below, or
   `tests/static/service-role.test.ts` fails.

**Branches (7b):** none of these show staff a list across the organisation.
Staff-side uses all act on one record the staff member's own client has just
read, so branch rules on that read cover them. Recheck this when adding any
staff-facing use.

## Files

| File | Used for | Scoped by |
|---|---|---|
| `src/server/confirm-actions.ts` | A supplier's answer through the no-login link | The link's token (stored hashed); the PO and organisation come from the link |
| `src/server/confirm-page.ts` | Showing the no-login confirmation page | The link's token |
| `src/server/cron.ts` | Scheduled jobs | `CRON_SECRET`; each row carries its own organisation |
| `src/server/tracking-poll.ts` | Checking shipments with carriers | Scheduled job; writes keyed by shipment id; each shipment checked only with its own organisation's credentials |
| `src/server/aggregator.ts` | Aggregator tracking: registering shipments, signed webhooks, safety-net checks, cost counting | Scheduled job (`CRON_SECRET`) or the provider's webhook signature; every update goes only to the shipment registered for that parcel, which carries its own organisation |
| `src/server/credentials.ts` | **Decrypting integration credentials** (`getIntegrationCredentials`) | An explicit organisation id; the secret only decrypts for that organisation, provider and kind |
| `src/server/inbound-webhook.ts` | Supplier replies forwarded to an organisation's COAST address (Mailgun) | Mailgun's signature (fresh, used once); the organisation comes only from the random address; POs looked up within that organisation only |
| `src/server/m365.ts` | Microsoft 365 consent; reading each connected mailbox | Consent: a signed, expiring state naming the organisation and the same signed-in admin. Mailbox job: `CRON_SECRET`, each organisation read with its own tenant's token and its mail handled as its own |
| `src/server/notifications.ts` | Customer update emails and the daily digest | An order id from that order's own event; built through the masking function |
| `src/server/customer-view.ts` | The customer tracking page | The tracking code; masking function plus final leak scan |
| `src/server/customer-session.ts` | Who the signed-in customer is | Their own sign-in |
| `src/server/customer-account-actions.ts` | Customer accounts: sign in, add or remove orders, invitations, links | The customer's own account or a tracking code; staff invitations after the staff member's RLS read of the order |
| `src/server/portal.ts` | The customer portal | The customer's own account; masking function |
| `src/server/portal-actions.ts` | Customer messages, update settings, problem reports | The tracking code; rate-limited |
| `src/server/lead-actions.ts` | "Get COAST for your business" interest form | Writes only to `leads` (no organisation data read) |
| `src/server/customer-actions.ts` | Leak scan before a staff reply; new tracking code | After the staff member's RLS read of the order |
| `src/server/customer-staff.ts` | Preview of what the customer sees, on the order page | After the staff member's RLS read of the order |
| `src/server/goods-in-actions.ts` | The order behind a checked-in line; drafting a delivery problem | The line came from the staff member's own goods-in list (RLS function) |
| `src/server/predictions.ts` | Recalculating delivery dates | Order ids from the caller's own scoped work; `refreshOrganisation(orgId)` takes the organisation explicitly |
| `src/server/prediction-actions.ts` | Refreshing orders after availability changes | The staff member's own organisation id (`staff.orgId`) |
| `src/server/problem-actions.ts` | Photos, problem history, the replacement line | After the staff member's RLS read of the problem |
| `src/server/problems.ts` | Short-lived photo links | After the staff member's RLS read of the problem |
| `src/server/shipment-actions.ts` | "Check now"; drafting a carrier problem | After the staff member's RLS read of the shipment |

Also using the key, outside the app: `scripts/lib/admin.ts` (owner scripts,
refuse production where they'd seed) and the test suites under `tests/`.
