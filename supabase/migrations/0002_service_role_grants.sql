-- 0002_service_role_grants.sql
-- Newer Supabase projects no longer grant table privileges to API roles by
-- default. The service role (admin scripts and cron jobs only, bypasses RLS)
-- needs explicit access. Every later migration that creates a table must
-- grant service_role in the same migration.

grant all on public.organisations to service_role;
grant all on public.staff_users to service_role;
