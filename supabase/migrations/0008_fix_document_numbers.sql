-- 0008_fix_document_numbers.sql
-- next_document_number() from 0007 failed with "column reference kind is
-- ambiguous": its parameter names matched document_counters' columns.
-- Recreated with distinct parameter names; callers pass arguments by
-- position, so nothing else changes.

drop function public.next_document_number(uuid, text);

create function public.next_document_number(p_org uuid, p_kind text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  n bigint;
  start bigint := case p_kind when 'so' then 10001 else 5001 end;
begin
  insert into public.document_counters as dc (org_id, kind, next_value)
  values (p_org, p_kind, start + 1)
  on conflict (org_id, kind) do update set next_value = dc.next_value + 1
  returning dc.next_value - 1 into n;
  return upper(p_kind) || '-' || n;
end;
$$;

revoke all on function public.next_document_number(uuid, text) from public, anon, authenticated;
