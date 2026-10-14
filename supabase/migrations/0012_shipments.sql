-- 0012_shipments.sql
-- Phase 3: shipments and carrier tracking (spec §5.2, §9.2).
--
--   shipments              one parcel or consignment for an order: leg, carrier, tracking number, status, ETA, customs
--   shipment_lines         which order lines travel on it
--   tracking_events        what the carrier (or a person) reported, append-only
--   shipment_poll_state    when COAST last checked and next checks it (kept apart so polling never floods the audit log)
--   carrier_settings       per organisation, per carrier: claim window (decision C9, blank until set)
--   carrier_activity       platform-wide: each carrier's calls today and recent outcomes (one set of credentials per carrier)
--   cron_runs              every scheduled-job run and its outcome (decisions B12)
--
-- Masking holds: a shipment that comes from a supplier (inbound or direct)
-- is hidden from anyone without supplier.identity.view — its tracking
-- number can lead to the supplier.
-- Keep enums in step with src/lib/logic/shipments.ts and carriers.ts.

create type public.shipment_leg as enum ('inbound', 'outbound', 'direct');
create type public.shipment_status as enum ('pre_transit', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'unknown');
create type public.customs_status as enum ('not_required', 'unknown', 'in_progress', 'held', 'cleared');

create function public.is_carrier_key(k text)
returns boolean language sql immutable set search_path = '' as $$
  select k in ('dhl', 'fedex', 'tnt', 'ups', 'royal_mail', 'dpd', 'evri', 'yodel', 'other', 'unknown', 'mock')
$$;

-- ── New permission: add and update shipments ────────────────────────────────
insert into public.permissions (key, sort_order) values ('shipments.manage', 318);
insert into public.permission_defaults (role, permission) values ('procurement', 'shipments.manage');
insert into public.role_permissions (org_id, role, permission, granted_by)
select o.id, 'procurement', 'shipments.manage', null from public.organisations o
on conflict do nothing;

-- ── Shipments ───────────────────────────────────────────────────────────────
create table public.shipments (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organisations (id) on delete cascade,
  sales_order_id    uuid not null,
  leg               public.shipment_leg not null,
  carrier           text not null check (public.is_carrier_key(carrier)),
  tracking_number   text check (tracking_number ~ '^[A-Z0-9-]{4,40}$'),
  status            public.shipment_status not null default 'unknown',
  status_source     text not null default 'carrier' check (status_source in ('carrier', 'manual')),
  status_text       text check (length(status_text) <= 300),
  estimated_from    date,
  estimated_to      date,
  delivered_at      timestamptz,
  is_international  boolean not null default false,
  customs_status    public.customs_status not null default 'not_required',
  customs_source    text not null default 'carrier' check (customs_source in ('carrier', 'manual')),
  note              text check (length(note) <= 1000),
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, org_id),
  foreign key (sales_order_id, org_id) references public.sales_orders (id, org_id) on delete cascade,
  check (estimated_to is null or estimated_from is null or estimated_to >= estimated_from),
  check (tracking_number is not null or carrier = 'other')
);

create unique index shipments_order_tracking_idx on public.shipments (sales_order_id, carrier, tracking_number) where tracking_number is not null;
create index shipments_org_created_idx on public.shipments (org_id, created_at desc);
create index shipments_order_idx on public.shipments (sales_order_id);
create index shipments_tracking_idx on public.shipments (org_id, tracking_number);

create trigger shipments_set_updated_at before update on public.shipments for each row execute function public.set_updated_at();
create trigger shipments_set_created_by before insert on public.shipments for each row execute function public.set_created_by();

create table public.shipment_lines (
  shipment_id    uuid not null references public.shipments (id) on delete cascade,
  order_line_id  uuid not null references public.order_lines (id) on delete cascade,
  primary key (shipment_id, order_line_id)
);

create index shipment_lines_line_idx on public.shipment_lines (order_line_id);

create table public.tracking_events (
  id           bigint generated always as identity primary key,
  shipment_id  uuid not null references public.shipments (id) on delete cascade,
  -- Identity for de-duplication: time + wording (src/lib/logic/shipments.ts eventKey).
  event_key    text not null check (length(event_key) between 1 and 600),
  occurred_at  timestamptz not null,
  status       public.shipment_status not null,
  description  text not null check (length(btrim(description)) between 1 and 500),
  location     text check (length(location) <= 200),
  source       text not null check (source in ('carrier', 'manual')),
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (shipment_id, event_key)
);

create index tracking_events_shipment_idx on public.tracking_events (shipment_id, occurred_at desc);

create table public.shipment_poll_state (
  shipment_id     uuid primary key references public.shipments (id) on delete cascade,
  carrier         text not null check (public.is_carrier_key(carrier)),
  next_poll_at    timestamptz,
  last_polled_at  timestamptz,
  failures        integer not null default 0 check (failures >= 0),
  last_error      text check (length(last_error) <= 300)
);

create index shipment_poll_state_due_idx on public.shipment_poll_state (next_poll_at) where next_poll_at is not null;

-- A new shipment with a tracking number is due a check straight away.
create function public.shipments_init_poll_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.shipment_poll_state (shipment_id, carrier, next_poll_at)
  values (new.id, new.carrier, case when new.tracking_number is not null and new.status <> 'delivered' then now() end);
  return new;
end;
$$;

-- Changing the carrier or number starts checking afresh; delivered stops it.
create function public.shipments_sync_poll_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.carrier is distinct from old.carrier or new.tracking_number is distinct from old.tracking_number then
    update public.shipment_poll_state
    set carrier = new.carrier, failures = 0, last_error = null,
        next_poll_at = case when new.tracking_number is not null and new.status <> 'delivered' then now() end
    where shipment_id = new.id;
  elsif new.status = 'delivered' and old.status <> 'delivered' and new.status_source = 'manual' then
    update public.shipment_poll_state set next_poll_at = null where shipment_id = new.id;
  elsif old.status = 'delivered' and new.status <> 'delivered' then
    update public.shipment_poll_state set next_poll_at = now() where shipment_id = new.id and new.tracking_number is not null;
  end if;
  return new;
end;
$$;

revoke all on function public.shipments_init_poll_state() from public, anon, authenticated;
revoke all on function public.shipments_sync_poll_state() from public, anon, authenticated;
create trigger shipments_init_poll_state after insert on public.shipments for each row execute function public.shipments_init_poll_state();
create trigger shipments_sync_poll_state after update on public.shipments for each row execute function public.shipments_sync_poll_state();

-- ── Per-organisation carrier settings ───────────────────────────────────────
create table public.carrier_settings (
  org_id             uuid not null references public.organisations (id) on delete cascade,
  carrier            text not null check (public.is_carrier_key(carrier)),
  claim_window_days  integer check (claim_window_days between 1 and 365),
  updated_by         uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at         timestamptz not null default now(),
  primary key (org_id, carrier)
);

create trigger carrier_settings_set_updated_at before update on public.carrier_settings for each row execute function public.set_updated_at();

-- ── Platform-wide: carrier usage and health, scheduled runs ─────────────────
-- Not organisation data: one set of credentials per carrier serves everyone.
create table public.carrier_activity (
  carrier               text primary key check (public.is_carrier_key(carrier)),
  usage_day             date not null default current_date,
  calls_today           integer not null default 0 check (calls_today >= 0),
  last_success_at       timestamptz,
  last_error_at         timestamptz,
  last_error_kind       text check (last_error_kind in ('auth', 'rate_limited', 'unavailable', 'bad_response', 'unsupported')),
  consecutive_failures  integer not null default 0 check (consecutive_failures >= 0)
);

-- Reserve up to p_wanted calls against today's limit (UTC day); returns how many were granted.
create function public.reserve_carrier_calls(p_carrier text, p_limit integer, p_wanted integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'utc')::date;
  used integer;
  granted integer;
begin
  insert into public.carrier_activity (carrier, usage_day) values (p_carrier, today) on conflict (carrier) do nothing;
  select case when usage_day = today then calls_today else 0 end into used
  from public.carrier_activity where carrier = p_carrier for update;
  granted := greatest(0, least(greatest(p_wanted, 0), case when p_limit is null then p_wanted else p_limit - used end));
  update public.carrier_activity set usage_day = today, calls_today = used + granted where carrier = p_carrier;
  return granted;
end;
$$;

-- Record how a call went: p_error null = success.
create function public.record_carrier_outcome(p_carrier text, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.carrier_activity (carrier) values (p_carrier) on conflict (carrier) do nothing;
  if p_error is null then
    update public.carrier_activity set last_success_at = now(), consecutive_failures = 0 where carrier = p_carrier;
  else
    update public.carrier_activity
    set last_error_at = now(), last_error_kind = p_error, consecutive_failures = consecutive_failures + 1
    where carrier = p_carrier;
  end if;
end;
$$;

revoke all on function public.reserve_carrier_calls(text, integer, integer) from public, anon, authenticated;
revoke all on function public.record_carrier_outcome(text, text) from public, anon, authenticated;
grant execute on function public.reserve_carrier_calls(text, integer, integer) to service_role;
grant execute on function public.record_carrier_outcome(text, text) to service_role;

create table public.cron_runs (
  id           bigint generated always as identity primary key,
  job          text not null check (job ~ '^[a-z-]{2,40}$'),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  outcome      text check (outcome in ('ok', 'partial', 'error')),
  -- Counts across every organisation: service role only.
  detail       jsonb not null default '{}'::jsonb
);

create index cron_runs_job_idx on public.cron_runs (job, started_at desc);

-- ── Order history ───────────────────────────────────────────────────────────
alter table public.order_events drop constraint order_events_kind_check;
alter table public.order_events add constraint order_events_kind_check check (kind in (
  'order_created', 'line_stage_changed', 'po_raised', 'po_status_changed', 'order_updated', 'line_added', 'line_updated',
  'po_emailed', 'supplier_responded', 'chase_opened', 'chase_chased', 'chase_resolved',
  'shipment_added', 'shipment_status_changed'
));

create function public.order_events_on_shipment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_events (sales_order_id, kind, detail, actor_id)
    values (new.sales_order_id, 'shipment_added', jsonb_build_object('shipment_id', new.id, 'leg', new.leg, 'carrier', new.carrier), auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.order_events (sales_order_id, kind, detail, actor_id)
    values (new.sales_order_id, 'shipment_status_changed',
            jsonb_build_object('shipment_id', new.id, 'leg', new.leg, 'carrier', new.carrier, 'from', old.status, 'to', new.status, 'source', new.status_source),
            auth.uid());
  end if;
  return new;
end;
$$;

revoke all on function public.order_events_on_shipment() from public, anon, authenticated;
create trigger shipments_event after insert or update of status on public.shipments for each row execute function public.order_events_on_shipment();

-- ── Adding a shipment (one step; RLS applies: SECURITY INVOKER) ─────────────
-- p: {sales_order_id, leg, carrier, tracking_number, is_international, customs_status, note, line_ids: [uuid]}
create function public.create_shipment(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  org uuid := public.current_org_id();
  shipment_id uuid;
  line_id text;
begin
  if org is null then raise exception 'Not signed in as staff' using errcode = '42501'; end if;

  insert into public.shipments (org_id, sales_order_id, leg, carrier, tracking_number, is_international, customs_status, note)
  values (
    org, (p ->> 'sales_order_id')::uuid, (p ->> 'leg')::public.shipment_leg, p ->> 'carrier', nullif(p ->> 'tracking_number', ''),
    coalesce((p ->> 'is_international')::boolean, false), coalesce((p ->> 'customs_status')::public.customs_status, 'not_required'),
    nullif(p ->> 'note', '')
  ) returning id into shipment_id;

  for line_id in select * from jsonb_array_elements_text(coalesce(p -> 'line_ids', '[]'::jsonb)) loop
    insert into public.shipment_lines (shipment_id, order_line_id) values (shipment_id, line_id::uuid);
  end loop;

  return shipment_id;
end;
$$;

revoke all on function public.create_shipment(jsonb) from public, anon;
grant execute on function public.create_shipment(jsonb) to authenticated;

-- Orders can now be found by tracking number (spec §5.1). Still SECURITY
-- INVOKER, so a supplier's tracking number only matches for people allowed
-- to see that shipment.
create or replace function public.search_order_ids(q text)
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
  union
  select s.sales_order_id from public.shipments s, term
  where s.tracking_number ilike replace(term.t, ' ', '')
$$;

-- ── Audit ───────────────────────────────────────────────────────────────────
create trigger audit after insert or update or delete on public.shipments for each row execute function public.audit_row_change();
create trigger audit after insert or update or delete on public.shipment_lines for each row execute function public.audit_row_change('shipment_id', 'order_line_id');
create trigger audit after insert or update or delete on public.carrier_settings for each row execute function public.audit_row_change('org_id', 'carrier');

-- ── Privileges ──────────────────────────────────────────────────────────────
revoke all on public.shipments, public.shipment_lines, public.tracking_events, public.shipment_poll_state,
  public.carrier_settings, public.carrier_activity, public.cron_runs from anon, authenticated;

grant select, insert on public.shipments to authenticated;
grant update (carrier, tracking_number, status, status_source, status_text, delivered_at, customs_status, customs_source, note) on public.shipments to authenticated;
grant select, insert on public.shipment_lines to authenticated;
grant select, insert on public.tracking_events to authenticated;
grant select on public.shipment_poll_state to authenticated;
grant select, insert on public.carrier_settings to authenticated;
grant update (claim_window_days, updated_by) on public.carrier_settings to authenticated;
grant select on public.carrier_activity to authenticated;
grant select (id, job, started_at, finished_at, outcome) on public.cron_runs to authenticated;

grant all on public.shipments, public.shipment_lines, public.tracking_events, public.shipment_poll_state,
  public.carrier_settings, public.carrier_activity, public.cron_runs to service_role;

-- ── Row-level security ──────────────────────────────────────────────────────
alter table public.shipments enable row level security;
alter table public.shipment_lines enable row level security;
alter table public.tracking_events enable row level security;
alter table public.shipment_poll_state enable row level security;
alter table public.carrier_settings enable row level security;
alter table public.carrier_activity enable row level security;
alter table public.cron_runs enable row level security;

-- Shipments: through their order; supplier legs hidden with suppliers.
create policy shipments_select on public.shipments for select to authenticated
  using (org_id = public.current_org_id()
         and (leg = 'outbound' or public.has_permission('supplier.identity.view'))
         and exists (select 1 from public.sales_orders o where o.id = sales_order_id));
create policy shipments_insert on public.shipments for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_permission('shipments.manage')
              and (leg = 'outbound' or public.has_permission('supplier.identity.view'))
              and exists (select 1 from public.sales_orders o where o.id = sales_order_id));
create policy shipments_update on public.shipments for update to authenticated
  using (org_id = public.current_org_id() and public.has_permission('shipments.manage')
         and (leg = 'outbound' or public.has_permission('supplier.identity.view'))
         and exists (select 1 from public.sales_orders o where o.id = sales_order_id))
  with check (org_id = public.current_org_id());

-- Lines: through their shipment; the line must be on the shipment's own order.
create policy shipment_lines_select on public.shipment_lines for select to authenticated
  using (exists (select 1 from public.shipments s where s.id = shipment_id));
create policy shipment_lines_insert on public.shipment_lines for insert to authenticated
  with check (public.has_permission('shipments.manage')
              and exists (select 1 from public.shipments s join public.order_lines l on l.sales_order_id = s.sales_order_id
                          where s.id = shipment_id and l.id = order_line_id));

-- Events: through their shipment. People add only manual ones; carrier events come from the poll job.
create policy tracking_events_select on public.tracking_events for select to authenticated
  using (exists (select 1 from public.shipments s where s.id = shipment_id));
create policy tracking_events_insert on public.tracking_events for insert to authenticated
  with check (source = 'manual' and created_by = auth.uid() and public.has_permission('shipments.manage')
              and exists (select 1 from public.shipments s where s.id = shipment_id));

create policy shipment_poll_state_select on public.shipment_poll_state for select to authenticated
  using (exists (select 1 from public.shipments s where s.id = shipment_id));

create policy carrier_settings_select on public.carrier_settings for select to authenticated
  using (org_id = public.current_org_id());
create policy carrier_settings_insert on public.carrier_settings for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_permission('settings.edit'));
create policy carrier_settings_update on public.carrier_settings for update to authenticated
  using (org_id = public.current_org_id() and public.has_permission('settings.edit'))
  with check (org_id = public.current_org_id());

-- Platform-wide health: any signed-in staff member may read it (no organisation data in it).
create policy carrier_activity_select on public.carrier_activity for select to authenticated
  using (public.current_org_id() is not null);
create policy cron_runs_select on public.cron_runs for select to authenticated
  using (public.current_org_id() is not null);
