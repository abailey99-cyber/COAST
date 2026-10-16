-- 0034_link_lifetime.sql
-- Readiness plan Task 5B: how long a supplier's no-login confirmation link
-- works is a company setting (default 30 days, 1–90). Existing links keep
-- the expiry they were made with.
alter table public.chase_settings add column link_lifetime_days integer not null default 30 check (link_lifetime_days between 1 and 90);
grant update (link_lifetime_days) on public.chase_settings to authenticated;
