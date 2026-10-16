-- 0028_connected_providers.sql
-- Which integrations the signed-in person's organisation has connected —
-- just the provider names, nothing else — so shipment screens can say
-- "DHL isn't connected" to people who can't open Settings (where the
-- connection details are, readable only with section.settings).

create function public.connected_providers()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(provider order by provider), '{}')
  from public.integration_credentials
  where org_id = public.current_org_id() and status = 'active';
$$;

revoke all on function public.connected_providers() from public, anon;
grant execute on function public.connected_providers() to authenticated;
