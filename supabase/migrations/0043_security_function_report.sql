-- Phase 7b, step 3: the elevated-access audit. Database functions marked
-- SECURITY DEFINER run with the owner's rights and skip row-level security,
-- so any a signed-in person can call is a way round the branch rules. This
-- lists them for tests/rls/branches.test.ts, which checks each one is
-- reviewed in docs/security/branch-access-audit.md. Service role only.

create function public.security_definer_report()
returns table (function_name text, signed_in boolean, signed_out boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.proname::text,
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('anon', p.oid, 'execute')
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
    and p.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
  order by 1;
$$;

revoke all on function public.security_definer_report() from public, anon, authenticated;
grant execute on function public.security_definer_report() to service_role;
