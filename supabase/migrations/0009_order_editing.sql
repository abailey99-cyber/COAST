-- 0009_order_editing.sql
-- Editing an order after it's created: details, existing lines and new
-- lines in one all-or-nothing call, with history entries for each change.
-- The SO number and a line's fulfilment route stay fixed (no update grant).

-- ── New history kinds ───────────────────────────────────────────────────────
alter table public.order_events drop constraint order_events_kind_check;
alter table public.order_events add constraint order_events_kind_check
  check (kind in ('order_created', 'line_stage_changed', 'po_raised', 'po_status_changed', 'order_updated', 'line_added', 'line_updated'));

-- Which fields changed — names only, so history never repeats a price.
create function public.order_events_on_order_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  fields text[] := array[]::text[];
begin
  if new.customer_id is distinct from old.customer_id then fields := fields || 'customer'; end if;
  if new.customer_reference is distinct from old.customer_reference then fields := fields || 'customer_reference'; end if;
  if new.sales_rep_id is distinct from old.sales_rep_id then fields := fields || 'sales_rep'; end if;
  if new.currency is distinct from old.currency then fields := fields || 'currency'; end if;
  if new.promised_date is distinct from old.promised_date then fields := fields || 'promised_date'; end if;
  if (new.delivery_name, new.delivery_line1, new.delivery_line2, new.delivery_town, new.delivery_postcode, new.delivery_country)
     is distinct from (old.delivery_name, old.delivery_line1, old.delivery_line2, old.delivery_town, old.delivery_postcode, old.delivery_country)
  then fields := fields || 'delivery_address'; end if;
  if array_length(fields, 1) > 0 then
    insert into public.order_events (sales_order_id, kind, detail, actor_id)
    values (new.id, 'order_updated', jsonb_build_object('fields', to_jsonb(fields)), auth.uid());
  end if;
  return new;
end;
$$;

create function public.order_events_on_line_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  fields text[] := array[]::text[];
begin
  if new.sku is distinct from old.sku then fields := fields || 'sku'; end if;
  if new.description is distinct from old.description then fields := fields || 'description'; end if;
  if new.quantity is distinct from old.quantity then fields := fields || 'quantity'; end if;
  if new.unit_price_minor is distinct from old.unit_price_minor then fields := fields || 'price'; end if;
  if array_length(fields, 1) > 0 then
    insert into public.order_events (sales_order_id, order_line_id, kind, detail, actor_id)
    values (new.sales_order_id, new.id, 'line_updated', jsonb_build_object('fields', to_jsonb(fields)), auth.uid());
  end if;
  return new;
end;
$$;

-- A line added later (not in the transaction that created the order).
create function public.order_events_on_line_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.sales_orders o where o.id = new.sales_order_id and o.created_at < now()) then
    insert into public.order_events (sales_order_id, order_line_id, kind, actor_id)
    values (new.sales_order_id, new.id, 'line_added', auth.uid());
  end if;
  return new;
end;
$$;

revoke all on function public.order_events_on_order_update() from public, anon, authenticated;
revoke all on function public.order_events_on_line_update() from public, anon, authenticated;
revoke all on function public.order_events_on_line_insert() from public, anon, authenticated;

create trigger sales_orders_update_event after update on public.sales_orders for each row execute function public.order_events_on_order_update();
create trigger order_lines_update_event after update of sku, description, quantity, unit_price_minor on public.order_lines for each row execute function public.order_events_on_line_update();
create trigger order_lines_insert_event after insert on public.order_lines for each row execute function public.order_events_on_line_insert();

-- ── Atomic update (SECURITY INVOKER: RLS and column grants apply) ───────────
create function public.update_sales_order(p jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  org uuid := public.current_org_id();
  order_id uuid := (p ->> 'id')::uuid;
  cust uuid;
  line jsonb;
  n int;
begin
  if org is null then raise exception 'Not signed in as staff' using errcode = '42501'; end if;

  select c.id into cust from public.customers c where c.org_id = org and lower(c.name) = lower(btrim(p ->> 'customer_name'));
  if cust is null then
    insert into public.customers (org_id, name) values (org, btrim(p ->> 'customer_name')) returning id into cust;
  end if;

  update public.sales_orders set
    customer_id = cust,
    customer_reference = nullif(p ->> 'customer_reference', ''),
    sales_rep_id = nullif(p ->> 'sales_rep_id', '')::uuid,
    currency = p ->> 'currency',
    promised_date = nullif(p ->> 'promised_date', '')::date,
    delivery_name = p ->> 'delivery_name',
    delivery_line1 = p ->> 'delivery_line1',
    delivery_line2 = nullif(p ->> 'delivery_line2', ''),
    delivery_town = p ->> 'delivery_town',
    delivery_postcode = p ->> 'delivery_postcode',
    delivery_country = p ->> 'delivery_country'
  where id = order_id;
  if not found then raise exception 'Order not found or not editable' using errcode = '42501'; end if;

  for line in select * from jsonb_array_elements(coalesce(p -> 'line_updates', '[]'::jsonb)) loop
    update public.order_lines set
      sku = nullif(line ->> 'sku', ''),
      description = line ->> 'description',
      quantity = (line ->> 'quantity')::numeric,
      unit_price_minor = nullif(line ->> 'unit_price_minor', '')::bigint
    where id = (line ->> 'id')::uuid and sales_order_id = order_id and stage not in ('delivered', 'cancelled');
  end loop;

  select coalesce(max(l.line_no), 0) into n from public.order_lines l where l.sales_order_id = order_id;
  for line in select * from jsonb_array_elements(coalesce(p -> 'new_lines', '[]'::jsonb)) loop
    n := n + 1;
    insert into public.order_lines (sales_order_id, line_no, sku, description, quantity, unit_price_minor, route)
    values (
      order_id, n, nullif(line ->> 'sku', ''), line ->> 'description', (line ->> 'quantity')::numeric,
      nullif(line ->> 'unit_price_minor', '')::bigint, (line ->> 'route')::public.fulfilment_route
    );
  end loop;
end;
$$;

revoke all on function public.update_sales_order(jsonb) from public, anon;
grant execute on function public.update_sales_order(jsonb) to authenticated;
