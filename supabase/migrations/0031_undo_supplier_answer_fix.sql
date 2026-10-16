-- 0031_undo_supplier_answer_fix.sql
-- 0030's undo put the PO's status back as text; the column is the po_status
-- type, so it needs converting. Same function otherwise.

create or replace function public.undo_supplier_answer(p_response uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r record;
  line jsonb;
  previous_status text;
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
  previous_status := r.extras -> 'previous' ->> 'poStatus';
  if previous_status in ('draft', 'sent') then
    update public.purchase_orders set status = previous_status::public.po_status
    where id = r.purchase_order_id and status = 'confirmed';
  end if;

  update public.supplier_responses
  set status = 'rejected', undone_at = now(), undone_by = auth.uid(), reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = 'Undone: the automatically applied date was taken back.'
  where id = r.id;
end;
$$;
