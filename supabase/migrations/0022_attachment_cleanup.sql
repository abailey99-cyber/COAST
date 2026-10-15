-- 0022_attachment_cleanup.sql
-- Photo records point at their problem by (entity_type, entity_id), not a
-- foreign key, so remove them when the problem goes (e.g. its order is
-- deleted). The files in Storage are removed by the retention work in
-- Phase 9 (KNOWN-GAPS.md).

create function public.delivery_exceptions_remove_attachments()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.attachments where entity_type = 'delivery_exception' and entity_id = old.id;
  return old;
end;
$$;

revoke all on function public.delivery_exceptions_remove_attachments() from public, anon, authenticated;
create trigger delivery_exceptions_remove_attachments after delete on public.delivery_exceptions
  for each row execute function public.delivery_exceptions_remove_attachments();
