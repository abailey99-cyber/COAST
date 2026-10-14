-- 0019_goods_in.sql
-- Phase 6: checking deliveries in at the warehouse (spec §5.6 Goods-in).
--
--   goods_receipts       every check-in: how many arrived, in what condition, by whom
--   goods_in_expected()  the narrow view warehouse staff work from (they can't see orders)
--   record_goods_receipt(…)  one step: record it, move the line on, close the inbound shipment
--
-- Warehouse staff don't have "everyone's orders", so they never read
-- sales_orders directly; these two functions give exactly what check-in
-- needs and check goods_in.check themselves.

create table public.goods_receipts (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organisations (id) on delete cascade,
  order_line_id      uuid not null references public.order_lines (id) on delete cascade,
  shipment_id        uuid references public.shipments (id) on delete set null,
  quantity_received  numeric(12, 3) not null check (quantity_received >= 0),
  condition          text not null check (condition in ('ok', 'short', 'damaged', 'wrong_item')),
  note               text check (length(note) <= 1000),
  received_by        uuid references auth.users (id) on delete set null default auth.uid(),
  received_at        timestamptz not null default now()
);

create index goods_receipts_line_idx on public.goods_receipts (order_line_id);
create index goods_receipts_org_idx on public.goods_receipts (org_id, received_at desc);

alter table public.order_events drop constraint order_events_kind_check;
alter table public.order_events add constraint order_events_kind_check check (kind in (
  'order_created', 'line_stage_changed', 'po_raised', 'po_status_changed', 'order_updated', 'line_added', 'line_updated',
  'po_emailed', 'supplier_responded', 'chase_opened', 'chase_chased', 'chase_resolved',
  'shipment_added', 'shipment_status_changed', 'prediction_changed',
  'customer_message', 'staff_reply', 'customer_notified', 'goods_received'
));

-- What's due in: open "via warehouse" lines still waiting on their supplier.
create function public.goods_in_expected()
returns table (
  order_line_id uuid, so_number text, customer_name text, line_no integer, description text, sku text,
  quantity numeric, stage text, po_number text, supplier_name text, confirmed_date date,
  tracking jsonb, received_so_far numeric
)
language sql stable security definer set search_path = '' as $$
  select l.id, o.so_number, c.name, l.line_no, l.description, l.sku, l.quantity, l.stage::text,
         po.po_number, case when public.has_permission('supplier.identity.view') then s.name end, pl.confirmed_date,
         coalesce((select jsonb_agg(jsonb_build_object('carrier', sh.carrier, 'tracking', sh.tracking_number, 'status', sh.status, 'eta_from', sh.estimated_from, 'eta_to', sh.estimated_to, 'shipment_id', sh.id))
                   from public.shipment_lines sl join public.shipments sh on sh.id = sl.shipment_id
                   where sl.order_line_id = l.id and sh.leg = 'inbound'), '[]'::jsonb),
         coalesce((select sum(g.quantity_received) from public.goods_receipts g where g.order_line_id = l.id and g.condition in ('ok', 'short')), 0)
  from public.order_lines l
  join public.sales_orders o on o.id = l.sales_order_id
  join public.customers c on c.id = o.customer_id
  left join lateral (
    select pl.* from public.purchase_order_lines pl join public.purchase_orders p on p.id = pl.purchase_order_id
    where pl.order_line_id = l.id and p.status <> 'cancelled' order by pl.created_at desc limit 1
  ) pl on true
  left join public.purchase_orders po on po.id = pl.purchase_order_id
  left join public.suppliers s on s.id = po.supplier_id
  where o.org_id = public.current_org_id()
    and public.has_permission('goods_in.check')
    and l.route = 'via_warehouse'
    and l.stage in ('po_sent', 'confirmed', 'inbound')
  order by pl.confirmed_date nulls last, o.so_number, l.line_no
  limit 500
$$;

revoke all on function public.goods_in_expected() from public, anon;
grant execute on function public.goods_in_expected() to authenticated;

-- Record a check-in. A full, good delivery moves the line to "Received";
-- short or damaged ones are recorded and leave the line waiting.
create function public.record_goods_receipt(p_line uuid, p_quantity numeric, p_condition text, p_note text, p_shipment uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  org uuid := public.current_org_id();
  line record;
  total numeric;
  receipt uuid;
begin
  if org is null or not public.has_permission('goods_in.check') then
    raise exception 'Not allowed to check in deliveries' using errcode = '42501';
  end if;
  select l.id, l.quantity, l.stage, l.route, l.sales_order_id into line
  from public.order_lines l join public.sales_orders o on o.id = l.sales_order_id
  where l.id = p_line and o.org_id = org;
  if line.id is null or line.route <> 'via_warehouse' or line.stage not in ('po_sent', 'confirmed', 'inbound') then
    raise exception 'That line isn''t waiting to be checked in' using errcode = '22023';
  end if;
  if p_shipment is not null and not exists (
    select 1 from public.shipment_lines sl join public.shipments sh on sh.id = sl.shipment_id
    where sl.shipment_id = p_shipment and sl.order_line_id = p_line and sh.leg = 'inbound' and sh.org_id = org
  ) then
    raise exception 'That shipment isn''t for this line' using errcode = '22023';
  end if;

  insert into public.goods_receipts (org_id, order_line_id, shipment_id, quantity_received, condition, note)
  values (org, p_line, p_shipment, p_quantity, p_condition, nullif(btrim(p_note), ''))
  returning id into receipt;

  insert into public.order_events (sales_order_id, order_line_id, kind, detail, actor_id)
  values (line.sales_order_id, p_line, 'goods_received', jsonb_build_object('quantity', p_quantity, 'condition', p_condition), auth.uid());

  select coalesce(sum(quantity_received), 0) into total from public.goods_receipts
  where order_line_id = p_line and condition in ('ok', 'short');
  if total >= line.quantity and p_condition in ('ok', 'short') then
    update public.order_lines set stage = 'received' where id = p_line;
  end if;

  -- The inbound parcel has arrived, whatever its condition.
  if p_shipment is not null then
    update public.shipments set status = 'delivered', status_source = 'manual', delivered_at = coalesce(delivered_at, now())
    where id = p_shipment and status <> 'delivered';
  end if;
  return receipt;
end;
$$;

revoke all on function public.record_goods_receipt(uuid, numeric, text, text, uuid) from public, anon;
grant execute on function public.record_goods_receipt(uuid, numeric, text, text, uuid) to authenticated;

create trigger audit after insert or update or delete on public.goods_receipts for each row execute function public.audit_row_change();

revoke all on public.goods_receipts from anon, authenticated;
grant select on public.goods_receipts to authenticated;
grant all on public.goods_receipts to service_role;

alter table public.goods_receipts enable row level security;
-- Through the order (so order viewers see check-ins), or anyone who checks goods in.
create policy goods_receipts_select on public.goods_receipts for select to authenticated
  using (org_id = (select public.current_org_id())
         and ((select public.has_permission('goods_in.check'))
              or exists (select 1 from public.order_lines l join public.sales_orders o on o.id = l.sales_order_id where l.id = order_line_id)));
