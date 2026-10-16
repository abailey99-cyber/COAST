-- 0030_undo_supplier_answer.sql
-- Readiness plan Task 3: a date that applied itself from an email can be
-- undone in one click. Puts the PO's lines and status back exactly as they
-- were (saved on the answer as extras.previous), marks the answer undone,
-- and records it on the order history. Runs as the caller: their RLS and
-- their "Manage suppliers and POs" permission decide.

create function public.undo_supplier_answer(p_response uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r record;
  line jsonb;
begin
  if not public.has_permission('procurement.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select id, purchase_order_id, status, extras, undone_at into r
  from public.supplier_responses
  where id = p_response and org_id = public.current_org_id()
  for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if r.undone_at is not null then raise exception 'already undone' using errcode = 'P0001'; end if;
  if r.status <> 'applied' or r.extras -> 'previous' is null then raise exception 'nothing to undo' using errcode = 'P0001'; end if;

  for line in select * from jsonb_array_elements(r.extras -> 'previous' -> 'lines') loop
    update public.purchase_order_lines
    set confirmed_date = nullif(line ->> 'confirmedDate', '')::date,
        confirmed_quantity = nullif(line ->> 'confirmedQuantity', '')::numeric
    where id = (line ->> 'poLineId')::uuid and purchase_order_id = r.purchase_order_id;
  end loop;

  -- Back to the status it had (only ever "draft" or "sent" before confirming).
  update public.purchase_orders set status = r.extras -> 'previous' ->> 'poStatus'
  where id = r.purchase_order_id and status = 'confirmed' and (r.extras -> 'previous' ->> 'poStatus') in ('draft', 'sent');

  update public.supplier_responses
  set status = 'rejected', undone_at = now(), undone_by = auth.uid(), reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = 'Undone: the automatically applied date was taken back.'
  where id = r.id;
end;
$$;

revoke all on function public.undo_supplier_answer(uuid) from public, anon;
grant execute on function public.undo_supplier_answer(uuid) to authenticated;
grant update (undone_at, undone_by) on public.supplier_responses to authenticated;
