-- 0010_fix_edit_history.sql
-- 0009's history triggers appended to a text[] with `fields || 'name'`,
-- which Postgres reads as joining two arrays and fails ("malformed array
-- literal"), so every order edit errored. Use array_append instead.

create or replace function public.order_events_on_order_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  fields text[] := array[]::text[];
begin
  if new.customer_id is distinct from old.customer_id then fields := array_append(fields, 'customer'); end if;
  if new.customer_reference is distinct from old.customer_reference then fields := array_append(fields, 'customer_reference'); end if;
  if new.sales_rep_id is distinct from old.sales_rep_id then fields := array_append(fields, 'sales_rep'); end if;
  if new.currency is distinct from old.currency then fields := array_append(fields, 'currency'); end if;
  if new.promised_date is distinct from old.promised_date then fields := array_append(fields, 'promised_date'); end if;
  if (new.delivery_name, new.delivery_line1, new.delivery_line2, new.delivery_town, new.delivery_postcode, new.delivery_country)
     is distinct from (old.delivery_name, old.delivery_line1, old.delivery_line2, old.delivery_town, old.delivery_postcode, old.delivery_country)
  then fields := array_append(fields, 'delivery_address'); end if;
  if cardinality(fields) > 0 then
    insert into public.order_events (sales_order_id, kind, detail, actor_id)
    values (new.id, 'order_updated', jsonb_build_object('fields', to_jsonb(fields)), auth.uid());
  end if;
  return new;
end;
$$;

create or replace function public.order_events_on_line_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  fields text[] := array[]::text[];
begin
  if new.sku is distinct from old.sku then fields := array_append(fields, 'sku'); end if;
  if new.description is distinct from old.description then fields := array_append(fields, 'description'); end if;
  if new.quantity is distinct from old.quantity then fields := array_append(fields, 'quantity'); end if;
  if new.unit_price_minor is distinct from old.unit_price_minor then fields := array_append(fields, 'price'); end if;
  if cardinality(fields) > 0 then
    insert into public.order_events (sales_order_id, order_line_id, kind, detail, actor_id)
    values (new.sales_order_id, new.id, 'line_updated', jsonb_build_object('fields', to_jsonb(fields)), auth.uid());
  end if;
  return new;
end;
$$;
