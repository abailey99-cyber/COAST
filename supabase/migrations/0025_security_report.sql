-- 0025_security_report.sql
-- Readiness Task 5A: the cross-tenant harness asks the database itself, for
-- every table, whether row-level security is on and what signed-in users are
-- allowed to do, so a new table can't slip in without being tested.
-- Service role only.

create function public.security_table_report()
returns table (table_name text, rls_enabled boolean, rls_forced boolean, authenticated_privileges text[], anon_privileges text[], policy_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.relname::text,
    c.relrowsecurity,
    c.relforcerowsecurity,
    coalesce((select array_agg(distinct g.privilege_type::text order by g.privilege_type::text) from information_schema.role_table_grants g
              where g.table_schema = 'public' and g.table_name = c.relname and g.grantee = 'authenticated'), '{}'),
    coalesce((select array_agg(distinct g.privilege_type::text order by g.privilege_type::text) from information_schema.role_table_grants g
              where g.table_schema = 'public' and g.table_name = c.relname and g.grantee = 'anon'), '{}'),
    (select count(*)::integer from pg_catalog.pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
  order by c.relname;
$$;

revoke all on function public.security_table_report() from public, anon, authenticated;
grant execute on function public.security_table_report() to service_role;
