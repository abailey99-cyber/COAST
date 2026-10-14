-- 0007_core_schema.sql
-- Phase 1: the order and procurement backbone (spec §5.1, §9.2) and the
-- audit log (decisions B4).
--
--   currencies                 explicit list (C13)
--   customers                  per organisation
--   suppliers                  hidden from anyone without supplier.identity.view (E1)
--   sales_orders, order_lines  lines carry the fulfilment route and stage
--   purchase_orders (+ lines)  hidden with suppliers (PO numbers reveal supplier dealings)
--   purchase_order_line_costs  hidden from anyone without costs.view (E1)
--   order_events               append-only order history, written by triggers
--   audit_log                  append-only who-changed-what, written by triggers
--
-- Cross-organisation links are impossible by construction: child rows
-- reference (id, org_id) pairs, so an order can only point at a customer,
-- sales rep or supplier in its own organisation.
-- Keep enums in step with src/lib/logic/orders.ts and purchase-orders.ts.

create extension if not exists pgcrypto with schema extensions;

-- ── Reference: currencies ───────────────────────────────────────────────────
create table public.currencies (
  code         text primary key check (code ~ '^[A-Z]{3}$'),
  name         text not null,
  minor_units  smallint not null check (minor_units between 0 and 3)
);

insert into public.currencies (code, name, minor_units) values
  ('GBP', 'Pound sterling', 2),
  ('EUR', 'Euro', 2),
  ('USD', 'US dollar', 2);

-- ── Enums ───────────────────────────────────────────────────────────────────
create type public.fulfilment_route as enum ('from_stock', 'via_warehouse', 'direct_ship');

create type public.line_stage as enum (
  'ordered', 'po_sent', 'confirmed', 'inbound', 'received', 'picked', 'dispatched', 'in_transit', 'delivered', 'cancelled'
);

create type public.po_status as enum ('draft', 'sent', 'confirmed', 'cancelled');

-- Mirrors ROUTE_STAGES in src/lib/logic/orders.ts.
create function public.line_stage_valid(route public.fulfilment_route, stage public.line_stage)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select stage = 'cancelled' or case route
    when 'from_stock' then stage in ('ordered', 'picked', 'dispatched', 'in_transit', 'delivered')
    when 'via_warehouse' then stage in ('ordered', 'po_sent', 'confirmed', 'inbound', 'received', 'dispatched', 'in_transit', 'delivered')
    when 'direct_ship' then stage in ('ordered', 'po_sent', 'confirmed', 'dispatched', 'in_transit', 'delivered')
  end
$$;

-- ── Document numbers (SO-10001, PO-5001) ────────────────────────────────────
create table public.document_counters (
  org_id      uuid not null references public.organisations (id) on delete cascade,
  kind        text not null check (kind in ('so', 'po')),
  next_value  bigint not null,
  primary key (org_id, kind)
);

create function public.next_document_number(org uuid, kind text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  n bigint;
  start bigint := case kind when 'so' then 10001 else 5001 end;
begin
  insert into public.document_counters (org_id, kind, next_value)
  values (org, kind, start + 1)
  on conflict (org_id, kind) do update set next_value = public.document_counters.next_value + 1
  returning next_value - 1 into n;
  return upper(kind) || '-' || n;
end;
$$;

revoke all on function public.next_document_number(uuid, text) from public, anon, authenticated;

-- Random customer tracking code, e.g. K7Q-4M2-XP9 (decision E4). No 0/O, 1/I/L.
create function public.new_tracking_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  bytes bytea := extensions.gen_random_bytes(9);
  code text := '';
begin
  for i in 0..8 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % 31) + 1, 1);
    if i in (2, 5) then code := code || '-'; end if;
  end loop;
  return code;
end;
$$;

-- ── Shared trigger: keep "who made this" honest ─────────────────────────────
create function public.set_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := auth.uid();
  return new;
end;
$$;

-- Lets composite foreign keys point at staff in the same organisation.
alter table public.staff_users add constraint staff_users_id_org_key unique (id, org_id);

-- ── Customers ───────────────────────────────────────────────────────────────
create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 200),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, org_id)
);

create unique index customers_org_name_idx on public.customers (org_id, lower(name));

create trigger customers_set_updated_at before update on public.customers for each row execute function public.set_updated_at();
create trigger customers_set_created_by before insert on public.customers for each row execute function public.set_created_by();

-- ── Suppliers ───────────────────────────────────────────────────────────────
create table public.suppliers (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organisations (id) on delete cascade,
  name                    text not null check (length(btrim(name)) between 1 and 200),
  email                   text check (email is null or position('@' in email) > 1),
  phone                   text,
  currency                text not null default 'GBP' references public.currencies (code),
  typical_lead_time_days  integer check (typical_lead_time_days between 0 and 365),
  notes                   text,
  is_active               boolean not null default true,
  created_by              uuid references auth.users (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (id, org_id)
);

create unique index suppliers_org_name_idx on public.suppliers (org_id, lower(name));

create trigger suppliers_set_updated_at before update on public.suppliers for each row execute function public.set_updated_at();
create trigger suppliers_set_created_by before insert on public.suppliers for each row execute function public.set_created_by();

-- ── Sales orders ────────────────────────────────────────────────────────────
create table public.sales_orders (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organisations (id) on delete cascade,
  so_number           text not null check (so_number ~ '^[A-Z0-9][A-Z0-9/-]{0,39}$'),
  customer_id         uuid not null,
  customer_reference  text check (length(customer_reference) <= 100),
  sales_rep_id        uuid,
  currency            text not null default 'GBP' references public.currencies (code),
  promised_date       date,
  delivery_name       text not null check (length(btrim(delivery_name)) between 1 and 200),
  delivery_line1      text not null check (length(btrim(delivery_line1)) between 1 and 200),
  delivery_line2      text check (length(delivery_line2) <= 200),
  delivery_town       text not null check (length(btrim(delivery_town)) between 1 and 100),
  delivery_postcode   text not null check (length(btrim(delivery_postcode)) between 1 and 20),
  delivery_country    text not null default 'GB' check (delivery_country ~ '^[A-Z]{2}$'),
  tracking_code       text not null unique default public.new_tracking_code(),
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (org_id, so_number),
  foreign key (customer_id, org_id) references public.customers (id, org_id),
  foreign key (sales_rep_id, org_id) references public.staff_users (id, org_id)
);

create index sales_orders_org_created_idx on public.sales_orders (org_id, created_at desc);
create index sales_orders_org_rep_idx on public.sales_orders (org_id, sales_rep_id);
create index sales_orders_customer_idx on public.sales_orders (customer_id);

create function public.sales_orders_assign_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.so_number is null or btrim(new.so_number) = '' then
    loop
      new.so_number := public.next_document_number(new.org_id, 'so');
      exit when not exists (select 1 from public.sales_orders where org_id = new.org_id and so_number = new.so_number);
    end loop;
  end if;
  return new;
end;
$$;

create trigger sales_orders_assign_number before insert on public.sales_orders for each row execute function public.sales_orders_assign_number();
create trigger sales_orders_set_updated_at before update on public.sales_orders for each row execute function public.set_updated_at();
create trigger sales_orders_set_created_by before insert on public.sales_orders for each row execute function public.set_created_by();

-- ── Order lines ─────────────────────────────────────────────────────────────
create table public.order_lines (
  id                 uuid primary key default gen_random_uuid(),
  sales_order_id     uuid not null references public.sales_orders (id) on delete cascade,
  line_no            integer not null check (line_no between 1 and 999),
  sku                text check (length(sku) <= 100),
  description        text not null check (length(btrim(description)) between 1 and 500),
  quantity           numeric(12, 3) not null check (quantity > 0),
  unit_price_minor   bigint check (unit_price_minor >= 0),
  route              public.fulfilment_route not null,
  stage              public.line_stage not null default 'ordered',
  hs_code            text check (hs_code ~ '^[0-9]{6,10}$'),
  country_of_origin  text check (country_of_origin ~ '^[A-Z]{2}$'),
  dangerous_goods    text check (length(dangerous_goods) <= 500),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (sales_order_id, line_no),
  check (public.line_stage_valid(route, stage))
);

create index order_lines_order_idx on public.order_lines (sales_order_id);

create trigger order_lines_set_updated_at before update on public.order_lines for each row execute function public.set_updated_at();

-- ── Purchase orders ─────────────────────────────────────────────────────────
create table public.purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations (id) on delete cascade,
  po_number    text not null,
  supplier_id  uuid not null,
  currency     text not null default 'GBP' references public.currencies (code),
  status       public.po_status not null default 'draft',
  notes        text check (length(notes) <= 2000),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_id, po_number),
  foreign key (supplier_id, org_id) references public.suppliers (id, org_id)
);

create index purchase_orders_org_created_idx on public.purchase_orders (org_id, created_at desc);
create index purchase_orders_supplier_idx on public.purchase_orders (supplier_id);

create function public.purchase_orders_assign_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.po_number is null or btrim(new.po_number) = '' then
    loop
      new.po_number := public.next_document_number(new.org_id, 'po');
      exit when not exists (select 1 from public.purchase_orders where org_id = new.org_id and po_number = new.po_number);
    end loop;
  end if;
  return new;
end;
$$;

create trigger purchase_orders_assign_number before insert on public.purchase_orders for each row execute function public.purchase_orders_assign_number();
create trigger purchase_orders_set_updated_at before update on public.purchase_orders for each row execute function public.set_updated_at();
create trigger purchase_orders_set_created_by before insert on public.purchase_orders for each row execute function public.set_created_by();

create table public.purchase_order_lines (
  id                 uuid primary key default gen_random_uuid(),
  purchase_order_id  uuid not null references public.purchase_orders (id) on delete cascade,
  order_line_id      uuid not null references public.order_lines (id) on delete restrict,
  quantity           numeric(12, 3) not null check (quantity > 0),
  requested_date     date,
  created_at         timestamptz not null default now(),
  unique (purchase_order_id, order_line_id)
);

create index purchase_order_lines_po_idx on public.purchase_order_lines (purchase_order_id);
create index purchase_order_lines_order_line_idx on public.purchase_order_lines (order_line_id);

create table public.purchase_order_line_costs (
  purchase_order_line_id  uuid primary key references public.purchase_order_lines (id) on delete cascade,
  unit_cost_minor         bigint not null check (unit_cost_minor >= 0),
  updated_at              timestamptz not null default now()
);

create trigger purchase_order_line_costs_set_updated_at before update on public.purchase_order_line_costs for each row execute function public.set_updated_at();

-- ── Order history (append-only, written by triggers) ────────────────────────
create table public.order_events (
  id              bigint generated always as identity primary key,
  sales_order_id  uuid not null references public.sales_orders (id) on delete cascade,
  order_line_id   uuid references public.order_lines (id) on delete cascade,
  kind            text not null check (kind in ('order_created', 'line_stage_changed', 'po_raised', 'po_status_changed')),
  -- Never a supplier name or cost: the order's history is visible to anyone
  -- who can see the order. PO references are by id and resolved at read time.
  detail          jsonb not null default '{}'::jsonb,
  actor_id        uuid references auth.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now()
);

create index order_events_order_idx on public.order_events (sales_order_id, created_at);

create function public.order_events_on_order_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.order_events (sales_order_id, kind, actor_id) values (new.id, 'order_created', auth.uid());
  return new;
end;
$$;

create function public.order_events_on_stage_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.stage is distinct from old.stage then
    insert into public.order_events (sales_order_id, order_line_id, kind, detail, actor_id)
    values (new.sales_order_id, new.id, 'line_stage_changed', jsonb_build_object('from', old.stage, 'to', new.stage), auth.uid());
  end if;
  return new;
end;
$$;

-- Raising a PO moves the line to "Awaiting supplier" (the only way it gets there).
create function public.on_po_line_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  order_id uuid;
begin
  select l.sales_order_id into order_id from public.order_lines l where l.id = new.order_line_id;
  update public.order_lines set stage = 'po_sent' where id = new.order_line_id and stage = 'ordered';
  insert into public.order_events (sales_order_id, order_line_id, kind, detail, actor_id)
  values (order_id, new.order_line_id, 'po_raised', jsonb_build_object('purchase_order_id', new.purchase_order_id), auth.uid());
  return new;
end;
$$;

-- PO status changes flow to its lines: confirmed → "Supplier confirmed";
-- cancelled → back to "Needs PO" unless another live PO covers the line.
create function public.on_po_status_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is not distinct from old.status then return new; end if;

  insert into public.order_events (sales_order_id, kind, detail, actor_id)
  select distinct l.sales_order_id, 'po_status_changed',
         jsonb_build_object('purchase_order_id', new.id, 'from', old.status, 'to', new.status), auth.uid()
  from public.purchase_order_lines pl join public.order_lines l on l.id = pl.order_line_id
  where pl.purchase_order_id = new.id;

  if new.status = 'confirmed' then
    update public.order_lines l set stage = 'confirmed'
    from public.purchase_order_lines pl
    where pl.purchase_order_id = new.id and pl.order_line_id = l.id and l.stage = 'po_sent';
  elsif new.status = 'cancelled' then
    update public.order_lines l set stage = 'ordered'
    from public.purchase_order_lines pl
    where pl.purchase_order_id = new.id and pl.order_line_id = l.id and l.stage in ('po_sent', 'confirmed')
      and not exists (
        select 1 from public.purchase_order_lines other
        join public.purchase_orders op on op.id = other.purchase_order_id
        where other.order_line_id = l.id and op.id <> new.id and op.status <> 'cancelled'
      );
  end if;
  return new;
end;
$$;

create trigger sales_orders_event after insert on public.sales_orders for each row execute function public.order_events_on_order_insert();
create trigger order_lines_stage_event after update of stage on public.order_lines for each row execute function public.order_events_on_stage_change();
create trigger purchase_order_lines_after_insert after insert on public.purchase_order_lines for each row execute function public.on_po_line_insert();
create trigger purchase_orders_status_change after update of status on public.purchase_orders for each row execute function public.on_po_status_change();

revoke all on function public.order_events_on_order_insert() from public, anon, authenticated;
revoke all on function public.order_events_on_stage_change() from public, anon, authenticated;
revoke all on function public.on_po_line_insert() from public, anon, authenticated;
revoke all on function public.on_po_status_change() from public, anon, authenticated;
revoke all on function public.sales_orders_assign_number() from public, anon, authenticated;
revoke all on function public.purchase_orders_assign_number() from public, anon, authenticated;

-- ── Audit log (decisions B4) ────────────────────────────────────────────────
-- Append-only: nobody can update or delete rows through the API, not even
-- admins or the service role. Written by triggers on every change, so no
-- code path can forget it.
create table public.audit_log (
  id          bigint generated always as identity primary key,
  org_id      uuid references public.organisations (id) on delete cascade,
  actor_id    uuid references auth.users (id) on delete set null,
  table_name  text not null,
  row_key     text not null,
  action      text not null check (action in ('insert', 'update', 'delete')),
  changes     jsonb not null,
  created_at  timestamptz not null default now()
);

create index audit_log_org_created_idx on public.audit_log (org_id, created_at desc);
create index audit_log_row_idx on public.audit_log (table_name, row_key);

-- Trigger arguments name the key columns (default: id).
create function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_row jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  old_row jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  row_data jsonb := coalesce(new_row, old_row);
  key_text text := '';
  diff jsonb := '{}'::jsonb;
  k text;
  i int;
begin
  if tg_nargs = 0 then
    key_text := row_data ->> 'id';
  else
    for i in 0..tg_nargs - 1 loop
      key_text := key_text || case when i > 0 then '/' else '' end || coalesce(row_data ->> tg_argv[i], '');
    end loop;
  end if;

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(new_row) loop
      if k not in ('updated_at') and (new_row -> k) is distinct from (old_row -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_object('old', old_row -> k, 'new', new_row -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then return new; end if;
  elsif tg_op = 'INSERT' then
    diff := new_row - 'created_at' - 'updated_at';
  else
    diff := old_row;
  end if;

  insert into public.audit_log (org_id, actor_id, table_name, row_key, action, changes)
  values (
    coalesce((row_data ->> 'org_id')::uuid, public.current_org_id()),
    auth.uid(),
    tg_table_name,
    key_text,
    lower(tg_op),
    diff
  );
  return coalesce(new, old);
end;
$$;

revoke all on function public.audit_row_change() from public, anon, authenticated;

create trigger audit after insert or update or delete on public.organisations for each row execute function public.audit_row_change();
create trigger audit after insert or update or delete on public.staff_users for each row execute function public.audit_row_change();
create trigger audit after insert or update or delete on public.role_permissions for each row execute function public.audit_row_change('org_id', 'role', 'permission');
create trigger audit after insert or update or delete on public.staff_permission_overrides for each row execute function public.audit_row_change('user_id', 'permission');
create trigger audit after insert or update or delete on public.customers for each row execute function public.audit_row_change();
create trigger audit after insert or update or delete on public.suppliers for each row execute function public.audit_row_change();
create trigger audit after insert or update or delete on public.sales_orders for each row execute function public.audit_row_change();
create trigger audit after insert or update or delete on public.order_lines for each row execute function public.audit_row_change();
create trigger audit after insert or update or delete on public.purchase_orders for each row execute function public.audit_row_change();
create trigger audit after insert or update or delete on public.purchase_order_lines for each row execute function public.audit_row_change();
create trigger audit after insert or update or delete on public.purchase_order_line_costs for each row execute function public.audit_row_change('purchase_order_line_id');

-- ── New permission: see the audit log ───────────────────────────────────────
insert into public.permissions (key, sort_order) values ('audit.view', 230);
insert into public.permission_defaults (role, permission) values ('director', 'audit.view');
insert into public.role_permissions (org_id, role, permission, granted_by)
select o.id, 'director', 'audit.view', null from public.organisations o
on conflict do nothing;

-- ── Atomic create functions (RLS applies: SECURITY INVOKER) ─────────────────
-- The app validates first (src/lib/logic); these keep an order and its lines,
-- or a PO and its lines, all-or-nothing.

create function public.create_sales_order(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  org uuid := public.current_org_id();
  cust uuid;
  order_id uuid;
  line jsonb;
  n int := 0;
begin
  if org is null then raise exception 'Not signed in as staff' using errcode = '42501'; end if;

  select c.id into cust from public.customers c where c.org_id = org and lower(c.name) = lower(btrim(p ->> 'customer_name'));
  if cust is null then
    insert into public.customers (org_id, name) values (org, btrim(p ->> 'customer_name')) returning id into cust;
  end if;

  insert into public.sales_orders (
    org_id, so_number, customer_id, customer_reference, sales_rep_id, currency, promised_date,
    delivery_name, delivery_line1, delivery_line2, delivery_town, delivery_postcode, delivery_country
  ) values (
    org, nullif(p ->> 'so_number', ''), cust, nullif(p ->> 'customer_reference', ''), nullif(p ->> 'sales_rep_id', '')::uuid,
    p ->> 'currency', nullif(p ->> 'promised_date', '')::date,
    p ->> 'delivery_name', p ->> 'delivery_line1', nullif(p ->> 'delivery_line2', ''), p ->> 'delivery_town',
    p ->> 'delivery_postcode', p ->> 'delivery_country'
  ) returning id into order_id;

  for line in select * from jsonb_array_elements(p -> 'lines') loop
    n := n + 1;
    insert into public.order_lines (sales_order_id, line_no, sku, description, quantity, unit_price_minor, route)
    values (
      order_id, n, nullif(line ->> 'sku', ''), line ->> 'description', (line ->> 'quantity')::numeric,
      nullif(line ->> 'unit_price_minor', '')::bigint, (line ->> 'route')::public.fulfilment_route
    );
  end loop;

  return order_id;
end;
$$;

create function public.create_purchase_order(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  org uuid := public.current_org_id();
  po_id uuid;
  pol_id uuid;
  line jsonb;
begin
  if org is null then raise exception 'Not signed in as staff' using errcode = '42501'; end if;

  insert into public.purchase_orders (org_id, supplier_id, currency)
  values (org, (p ->> 'supplier_id')::uuid, p ->> 'currency')
  returning id into po_id;

  for line in select * from jsonb_array_elements(p -> 'lines') loop
    insert into public.purchase_order_lines (purchase_order_id, order_line_id, quantity, requested_date)
    values (po_id, (line ->> 'order_line_id')::uuid, (line ->> 'quantity')::numeric, nullif(line ->> 'requested_date', '')::date)
    returning id into pol_id;
    if nullif(line ->> 'unit_cost_minor', '') is not null then
      insert into public.purchase_order_line_costs (purchase_order_line_id, unit_cost_minor)
      values (pol_id, (line ->> 'unit_cost_minor')::bigint);
    end if;
  end loop;

  return po_id;
end;
$$;

revoke all on function public.create_sales_order(jsonb) from public, anon;
revoke all on function public.create_purchase_order(jsonb) from public, anon;
grant execute on function public.create_sales_order(jsonb) to authenticated;
grant execute on function public.create_purchase_order(jsonb) to authenticated;

-- Search used by the Orders screen. SECURITY INVOKER, so a PO number or
-- supplier name only matches for people allowed to see suppliers.
create function public.search_order_ids(q text)
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  with term as (
    select '%' || replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as t
  )
  select o.id from public.sales_orders o, term
  where o.so_number ilike term.t or o.customer_reference ilike term.t
  union
  select o.id from public.sales_orders o join public.customers c on c.id = o.customer_id, term
  where c.name ilike term.t
  union
  select l.sales_order_id from public.order_lines l, term
  where l.sku ilike term.t or l.description ilike term.t
  union
  select l.sales_order_id
  from public.order_lines l
  join public.purchase_order_lines pl on pl.order_line_id = l.id
  join public.purchase_orders po on po.id = pl.purchase_order_id
  join public.suppliers s on s.id = po.supplier_id, term
  where po.po_number ilike term.t or s.name ilike term.t
$$;

revoke all on function public.search_order_ids(text) from public, anon;
grant execute on function public.search_order_ids(text) to authenticated;

-- ── Privileges ──────────────────────────────────────────────────────────────
revoke all on public.currencies, public.document_counters, public.customers, public.suppliers, public.sales_orders,
  public.order_lines, public.purchase_orders, public.purchase_order_lines, public.purchase_order_line_costs,
  public.order_events, public.audit_log from anon, authenticated;

grant select on public.currencies to authenticated;
grant select, insert on public.customers to authenticated;
grant update (name) on public.customers to authenticated;
grant select, insert on public.suppliers to authenticated;
grant update (name, email, phone, currency, typical_lead_time_days, notes, is_active) on public.suppliers to authenticated;
grant select, insert on public.sales_orders to authenticated;
grant update (customer_id, customer_reference, sales_rep_id, currency, promised_date, delivery_name, delivery_line1,
  delivery_line2, delivery_town, delivery_postcode, delivery_country) on public.sales_orders to authenticated;
grant select, insert on public.order_lines to authenticated;
grant update (sku, description, quantity, unit_price_minor, stage, hs_code, country_of_origin, dangerous_goods) on public.order_lines to authenticated;
grant select, insert on public.purchase_orders to authenticated;
grant update (status, notes) on public.purchase_orders to authenticated;
grant select, insert on public.purchase_order_lines to authenticated;
grant update (quantity, requested_date) on public.purchase_order_lines to authenticated;
grant select, insert on public.purchase_order_line_costs to authenticated;
grant update (unit_cost_minor) on public.purchase_order_line_costs to authenticated;
grant select on public.order_events to authenticated;
grant select on public.audit_log to authenticated;

grant all on public.currencies, public.document_counters, public.customers, public.suppliers, public.sales_orders,
  public.order_lines, public.purchase_orders, public.purchase_order_lines, public.purchase_order_line_costs,
  public.order_events to service_role;
grant select, insert on public.audit_log to service_role;

-- ── Row-level security ──────────────────────────────────────────────────────
alter table public.currencies enable row level security;
alter table public.document_counters enable row level security;
alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.sales_orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.purchase_order_line_costs enable row level security;
alter table public.order_events enable row level security;
alter table public.audit_log enable row level security;

create policy currencies_select_all on public.currencies for select to authenticated using (true);
-- document_counters: no policies — only the numbering triggers touch it.

-- Customers: everyone in the organisation can see them; order editors add and rename.
create policy customers_select on public.customers for select to authenticated
  using (org_id = public.current_org_id());
create policy customers_insert on public.customers for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_permission('orders.edit'));
create policy customers_update on public.customers for update to authenticated
  using (org_id = public.current_org_id() and public.has_permission('orders.edit'))
  with check (org_id = public.current_org_id());

-- Suppliers: invisible without supplier.identity.view (E1).
create policy suppliers_select on public.suppliers for select to authenticated
  using (org_id = public.current_org_id() and public.has_permission('supplier.identity.view'));
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_permission('procurement.manage') and public.has_permission('supplier.identity.view'));
create policy suppliers_update on public.suppliers for update to authenticated
  using (org_id = public.current_org_id() and public.has_permission('procurement.manage') and public.has_permission('supplier.identity.view'))
  with check (org_id = public.current_org_id());

-- Sales orders: everyone's with orders.view_all, otherwise only your own (E1).
create policy sales_orders_select on public.sales_orders for select to authenticated
  using (org_id = public.current_org_id() and (public.has_permission('orders.view_all') or sales_rep_id = auth.uid()));
create policy sales_orders_insert on public.sales_orders for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_permission('orders.edit'));
create policy sales_orders_update on public.sales_orders for update to authenticated
  using (org_id = public.current_org_id() and public.has_permission('orders.edit')
         and (public.has_permission('orders.view_all') or sales_rep_id = auth.uid()))
  with check (org_id = public.current_org_id());

-- Order lines: through their order. Stage moves are open to order editors and procurement.
create policy order_lines_select on public.order_lines for select to authenticated
  using (exists (select 1 from public.sales_orders o where o.id = sales_order_id));
create policy order_lines_insert on public.order_lines for insert to authenticated
  with check (public.has_permission('orders.edit') and exists (select 1 from public.sales_orders o where o.id = sales_order_id));
create policy order_lines_update on public.order_lines for update to authenticated
  using ((public.has_permission('orders.edit') or public.has_permission('procurement.manage'))
         and exists (select 1 from public.sales_orders o where o.id = sales_order_id))
  with check (exists (select 1 from public.sales_orders o where o.id = sales_order_id));

-- Purchase orders: hidden with suppliers.
create policy purchase_orders_select on public.purchase_orders for select to authenticated
  using (org_id = public.current_org_id() and public.has_permission('supplier.identity.view'));
create policy purchase_orders_insert on public.purchase_orders for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_permission('procurement.manage') and public.has_permission('supplier.identity.view'));
create policy purchase_orders_update on public.purchase_orders for update to authenticated
  using (org_id = public.current_org_id() and public.has_permission('procurement.manage') and public.has_permission('supplier.identity.view'))
  with check (org_id = public.current_org_id());

-- PO lines: through their PO; the order line must belong to the same organisation.
create policy purchase_order_lines_select on public.purchase_order_lines for select to authenticated
  using (exists (select 1 from public.purchase_orders p where p.id = purchase_order_id));
create policy purchase_order_lines_insert on public.purchase_order_lines for insert to authenticated
  with check (
    public.has_permission('procurement.manage')
    and exists (
      select 1 from public.purchase_orders p
      join public.order_lines l on l.id = order_line_id
      join public.sales_orders o on o.id = l.sales_order_id
      where p.id = purchase_order_id and o.org_id = p.org_id
    )
  );
create policy purchase_order_lines_update on public.purchase_order_lines for update to authenticated
  using (public.has_permission('procurement.manage') and exists (select 1 from public.purchase_orders p where p.id = purchase_order_id))
  with check (exists (select 1 from public.purchase_orders p where p.id = purchase_order_id));

-- Costs: invisible without costs.view (E1).
create policy purchase_order_line_costs_select on public.purchase_order_line_costs for select to authenticated
  using (public.has_permission('costs.view') and exists (select 1 from public.purchase_order_lines pl where pl.id = purchase_order_line_id));
create policy purchase_order_line_costs_insert on public.purchase_order_line_costs for insert to authenticated
  with check (public.has_permission('costs.view') and public.has_permission('procurement.manage')
              and exists (select 1 from public.purchase_order_lines pl where pl.id = purchase_order_line_id));
create policy purchase_order_line_costs_update on public.purchase_order_line_costs for update to authenticated
  using (public.has_permission('costs.view') and public.has_permission('procurement.manage')
         and exists (select 1 from public.purchase_order_lines pl where pl.id = purchase_order_line_id))
  with check (exists (select 1 from public.purchase_order_lines pl where pl.id = purchase_order_line_id));

-- Order history: visible to anyone who can see the order. Written only by triggers.
create policy order_events_select on public.order_events for select to authenticated
  using (exists (select 1 from public.sales_orders o where o.id = sales_order_id));

-- Audit log: admins, and anyone given audit.view.
create policy audit_log_select on public.audit_log for select to authenticated
  using (org_id = public.current_org_id() and (public.is_admin() or public.has_permission('audit.view')));
