-- 0026_security_column_report.sql
-- Which columns signed-in users may update, per table, so the cross-tenant
-- harness can try a harmless update (a column set to its own value) against
-- another organisation's rows. Service role only.

create function public.security_update_columns()
returns table (table_name text, column_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.table_name::text, p.column_name::text
  from information_schema.column_privileges p
  where p.table_schema = 'public' and p.grantee = 'authenticated' and p.privilege_type = 'UPDATE'
  order by 1, 2;
$$;

revoke all on function public.security_update_columns() from public, anon, authenticated;
grant execute on function public.security_update_columns() to service_role;
