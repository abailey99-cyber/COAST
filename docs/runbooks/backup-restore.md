# Backups and restoring — runbook

Readiness plan Task 5B. What protects COAST's data, how to get it back, and
the one rehearsal to do before the first real customer.

## Where data lives

- **Database:** Supabase, project region **eu-west-1 (Ireland)** — checked
  16 October 2026. Staging and production must be created in an EU region
  too (`docs/environments.md`).
- **App:** Vercel, functions pinned to **dub1 (Dublin)** by `vercel.json`,
  next to the database, so personal data is processed in the EU.
- **Photos** (delivery problems): Supabase Storage, same project and region.
- **Secrets:** only in Vercel's settings. `COAST_CREDENTIAL_KEYS` is the one
  that matters most: keep a copy in your password manager. **A database
  backup without that key can't decrypt any organisation's integration
  credentials** — they would all need reconnecting.

## What to switch on (founder, production project)

1. Supabase → Project → **Settings → Add-ons → Point in Time Recovery**
   (needs the Pro plan). This lets you restore to any second in the
   retention window (7 days at the lowest tier).
2. Without PITR, Pro still keeps **daily backups for 7 days** (Settings →
   Database → Backups). The free plan keeps none you can restore yourself.
3. Storage (photos) isn't included in database backups. For now photos are
   evidence that also lives in the customer's own email; a scheduled copy
   to a second bucket is a later improvement (KNOWN-GAPS.md).

## Restoring

**Never restore over production to "have a look".** Restore into staging,
check, then decide.

1. Decide the moment to go back to (just before the problem).
2. Supabase dashboard → the **staging** project → Database → Backups →
   Point in time (or a daily backup) → choose the time → Restore. Note the
   time you start.
3. Wait for "Restore complete". Note the time.
4. Check in staging: sign in as an admin, open Orders, a recent PO and
   Settings → Security log; run `npm run db:push` against staging to
   confirm no migration is missing.
5. If production itself must be restored: tell customers first (status
   message), pause scheduled jobs (GitHub → Actions → disable the Tracking
   poll, Inbound mailbox and Notification digest workflows), restore, then
   re-enable them. Anything that happened after the restore point (supplier
   answers, tracking updates) arrives again: tracking on the next run,
   emails only if they're still in the mailbox.

## Rehearsal record

Do one restore into staging before the pilot and fill this in.

| Date | Backup type | Restore point | Started | Finished | Duration | Checked by | Notes |
|---|---|---|---|---|---|---|---|
| _not yet done_ | | | | | | | Needs staging (founder task) |
