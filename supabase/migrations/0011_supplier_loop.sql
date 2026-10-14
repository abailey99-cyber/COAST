-- 0011_supplier_loop.sql
-- Phase 2: the supplier communication loop.
--
--   purchase_orders.sent_at / confirmed_at   when, for escalation
--   purchase_order_lines.confirmed_*         what the supplier confirmed
--   purchase_order_line_costs.confirmed_*    confirmed price (costs.view only)
--   outbound_emails                          every email COAST writes (logged until M365 is connected)
--   po_links                                 no-login confirmation links: hash only, expiry, revocation
--   supplier_responses (+ _prices)           every supplier answer: link, pasted email, later inbound
--   chases                                   supplier chases and internal (sales → procurement) chases
--   chase_settings                           per-organisation escalation thresholds and working day
--
-- Masking holds: supplier answers keep their prices in a separate table
-- behind costs.view; links are stored only as a SHA-256 hash.

-- Composite keys so children can only point at rows in the same organisation.
alter table public.sales_orders add constraint sales_orders_id_org_key unique (id, org_id);
alter table public.purchase_orders add constraint purchase_orders_id_org_key unique (id, org_id);

-- ── When a PO was sent and confirmed ────────────────────────────────────────
alter table public.purchase_orders add column sent_at timestamptz, add column confirmed_at timestamptz;

create function public.purchase_orders_status_times()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'sent' and new.sent_at is null then new.sent_at := now(); end if;
    if new.status = 'confirmed' then
      if new.sent_at is null then new.sent_at := now(); end if;
      new.confirmed_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger purchase_orders_status_times before update of status on public.purchase_orders
  for each row execute function public.purchase_orders_status_times();

update public.purchase_orders set sent_at = created_at where status in ('sent', 'confirmed') and sent_at is null;
update public.purchase_orders set confirmed_at = updated_at where status = 'confirmed' and confirmed_at is null;

-- ── What the supplier confirmed ─────────────────────────────────────────────
alter table public.purchase_order_lines
  add column confirmed_date date,
  add column confirmed_quantity numeric(12, 3) check (confirmed_quantity >= 0);
grant update (confirmed_date, confirmed_quantity) on public.purchase_order_lines to authenticated;

alter table public.purchase_order_line_costs add column confirmed_unit_cost_minor bigint check (confirmed_unit_cost_minor >= 0);
grant update (confirmed_unit_cost_minor) on public.purchase_order_line_costs to authenticated;

-- ── Emails COAST writes ─────────────────────────────────────────────────────
create table public.outbound_emails (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organisations (id) on delete cascade,
  kind               text not null check (kind in ('po', 'po_chase')),
  purchase_order_id  uuid,
  to_address         text not null,
  subject            text not null,
  body_text          text not null,
  body_html          text not null,
  channel            text not null check (channel in ('log', 'm365')),
  status             text not null check (status in ('logged', 'sent', 'failed')),
  error              text,
  created_by         uuid references auth.users (id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  foreign key (purchase_order_id, org_id) references public.purchase_orders (id, org_id) on delete cascade
);

create index outbound_emails_po_idx on public.outbound_emails (purchase_order_id, created_at desc);

-- ── No-login confirmation links ─────────────────────────────────────────────
create table public.po_links (
  id                 uuid primary key default gen_random_uuid(),
  purchase_order_id  uuid not null references public.purchase_orders (id) on delete cascade,
  token_hash         text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at         timestamptz not null,
  revoked_at         timestamptz,
  revoked_by         uuid references auth.users (id) on delete set null,
  last_opened_at     timestamptz,
  created_by         uuid references auth.users (id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now()
);

create index po_links_po_idx on public.po_links (purchase_order_id);

-- ── Supplier answers ────────────────────────────────────────────────────────
create table public.supplier_responses (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organisations (id) on delete cascade,
  purchase_order_id  uuid not null,
  source             text not null check (source in ('link', 'paste', 'inbound')),
  raw_text           text check (length(raw_text) <= 50000),
  -- Answer per PO line, without prices: [{poLineId, available, quantity, date}]
  answer             jsonb not null default '[]'::jsonb,
  -- Extras read or entered: {trackingNumbers: [], supplierReference, note, currency}
  extras             jsonb not null default '{}'::jsonb,
  confidence         text not null check (confidence in ('high', 'medium', 'low')),
  reasons            jsonb not null default '[]'::jsonb,
  status             text not null check (status in ('applied', 'needs_review', 'accepted', 'rejected')),
  link_id            uuid references public.po_links (id) on delete set null,
  created_by         uuid references auth.users (id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  reviewed_by        uuid references auth.users (id) on delete set null,
  reviewed_at        timestamptz,
  review_note        text check (length(review_note) <= 2000),
  foreign key (purchase_order_id, org_id) references public.purchase_orders (id, org_id) on delete cascade
);

create index supplier_responses_org_status_idx on public.supplier_responses (org_id, status, created_at desc);
create index supplier_responses_po_idx on public.supplier_responses (purchase_order_id, created_at desc);

-- Prices the supplier gave: [{poLineId, unitCostMinor}] — costs.view only.
create table public.supplier_response_prices (
  supplier_response_id  uuid primary key references public.supplier_responses (id) on delete cascade,
  prices                jsonb not null default '[]'::jsonb
);

-- ── Chases ──────────────────────────────────────────────────────────────────
create table public.chases (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organisations (id) on delete cascade,
  kind               text not null check (kind in ('supplier', 'internal')),
  purchase_order_id  uuid,
  sales_order_id     uuid,
  order_line_id      uuid references public.order_lines (id) on delete cascade,
  note               text check (length(note) <= 2000),
  status             text not null default 'open' check (status in ('open', 'resolved')),
  opened_by          uuid references auth.users (id) on delete set null default auth.uid(),
  opened_at          timestamptz not null default now(),
  last_chased_at     timestamptz,
  chase_count        integer not null default 0 check (chase_count >= 0),
  resolved_by        uuid references auth.users (id) on delete set null,
  resolved_at        timestamptz,
  resolution_note    text check (length(resolution_note) <= 2000),
  foreign key (purchase_order_id, org_id) references public.purchase_orders (id, org_id) on delete cascade,
  foreign key (sales_order_id, org_id) references public.sales_orders (id, org_id) on delete cascade,
  check ((kind = 'supplier' and purchase_order_id is not null) or (kind = 'internal' and order_line_id is not null and sales_order_id is not null))
);

create unique index chases_one_open_supplier_idx on public.chases (purchase_order_id) where status = 'open' and kind = 'supplier';
create unique index chases_one_open_internal_idx on public.chases (order_line_id) where status = 'open' and kind = 'internal';
create index chases_org_status_idx on public.chases (org_id, status);

-- ── Escalation settings per organisation ────────────────────────────────────
create table public.chase_settings (
  org_id          uuid primary key references public.organisations (id) on delete cascade,
  amber_hours     integer not null default 8,
  red_hours       integer not null default 16,
  alert_hours     integer not null default 24,
  day_start_hour  integer not null default 9 check (day_start_hour between 0 and 23),
  day_end_hour    integer not null default 17 check (day_end_hour between 1 and 24),
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  check (amber_hours > 0 and amber_hours < red_hours and red_hours < alert_hours and alert_hours <= 2000),
  check (day_start_hour < day_end_hour)
);

create trigger chase_settings_set_updated_at before update on public.chase_settings for each row execute function public.set_updated_at();

create function public.seed_chase_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.chase_settings (org_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.seed_chase_settings() from public, anon, authenticated;
create trigger organisations_seed_chase_settings after insert on public.organisations for each row execute function public.seed_chase_settings();
insert into public.chase_settings (org_id) select id from public.organisations on conflict do nothing;

-- ── New permission: chase procurement about a line ──────────────────────────
insert into public.permissions (key, sort_order) values ('chases.internal', 315);
insert into public.permission_defaults (role, permission) values
  ('procurement', 'chases.internal'), ('sales_manager', 'chases.internal'), ('sales', 'chases.internal');
insert into public.role_permissions (org_id, role, permission, granted_by)
select o.id, d.role, d.permission, null
from public.organisations o join public.permission_defaults d on d.permission = 'chases.internal'
on conflict do nothing;

-- ── Order history for the new events ────────────────────────────────────────
alter table public.order_events drop constraint order_events_kind_check;
alter table public.order_events add constraint order_events_kind_check check (kind in (
  'order_created', 'line_stage_changed', 'po_raised', 'po_status_changed', 'order_updated', 'line_added', 'line_updated',
  'po_emailed', 'supplier_responded', 'chase_opened', 'chase_chased', 'chase_resolved'
));

-- Orders a PO covers.
create function public.orders_for_po(po uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct l.sales_order_id
  from public.purchase_order_lines pl join public.order_lines l on l.id = pl.order_line_id
  where pl.purchase_order_id = po
$$;
revoke all on function public.orders_for_po(uuid) from public, anon, authenticated;

create function public.order_events_on_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.purchase_order_id is not null then
    insert into public.order_events (sales_order_id, kind, detail, actor_id)
    select o, 'po_emailed', jsonb_build_object('purchase_order_id', new.purchase_order_id, 'email', new.kind, 'status', new.status), auth.uid()
    from public.orders_for_po(new.purchase_order_id) o;
  end if;
  return new;
end;
$$;

create function public.order_events_on_response()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_events (sales_order_id, kind, detail, actor_id)
    select o, 'supplier_responded', jsonb_build_object('purchase_order_id', new.purchase_order_id, 'source', new.source, 'status', new.status), auth.uid()
    from public.orders_for_po(new.purchase_order_id) o;
  end if;
  return new;
end;
$$;

create function public.order_events_on_chase()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  k text;
begin
  if tg_op = 'INSERT' then k := 'chase_opened';
  elsif new.status = 'resolved' and old.status <> 'resolved' then k := 'chase_resolved';
  elsif new.chase_count > old.chase_count then k := 'chase_chased';
  else return new;
  end if;
  if new.kind = 'internal' then
    insert into public.order_events (sales_order_id, order_line_id, kind, detail, actor_id)
    values (new.sales_order_id, new.order_line_id, k, jsonb_build_object('chase', 'internal'), auth.uid());
  else
    insert into public.order_events (sales_order_id, kind, detail, actor_id)
    select o, k, jsonb_build_object('chase', 'supplier', 'purchase_order_id', new.purchase_order_id), auth.uid()
    from public.orders_for_po(new.purchase_order_id) o;
  end if;
  return new;
end;
$$;

revoke all on function public.order_events_on_email() from public, anon, authenticated;
revoke all on function public.order_events_on_response() from public, anon, authenticated;
revoke all on function public.order_events_on_chase() from public, anon, authenticated;

create trigger outbound_emails_event after insert on public.outbound_emails for each row execute function public.order_events_on_email();
create trigger supplier_responses_event after insert or update of status on public.supplier_responses for each row execute function public.order_events_on_response();
create trigger chases_event after insert or update on public.chases for each row execute function public.order_events_on_chase();

-- ── Applying a supplier's answer (one step; RLS applies for staff) ──────────
-- p: {purchase_order_id, response_id, review_status ('applied'|'accepted'),
--     lines: [{po_line_id, confirmed_date, confirmed_quantity, confirmed_unit_cost_minor?}],
--     fully_confirmed: bool}
create function public.apply_supplier_answer(p jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  po uuid := (p ->> 'purchase_order_id')::uuid;
  line jsonb;
begin
  for line in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) loop
    update public.purchase_order_lines
    set confirmed_date = (line ->> 'confirmed_date')::date,
        confirmed_quantity = (line ->> 'confirmed_quantity')::numeric
    where id = (line ->> 'po_line_id')::uuid and purchase_order_id = po;
    if nullif(line ->> 'confirmed_unit_cost_minor', '') is not null then
      insert into public.purchase_order_line_costs as c (purchase_order_line_id, unit_cost_minor, confirmed_unit_cost_minor)
      values ((line ->> 'po_line_id')::uuid, (line ->> 'confirmed_unit_cost_minor')::bigint, (line ->> 'confirmed_unit_cost_minor')::bigint)
      on conflict (purchase_order_line_id) do update set confirmed_unit_cost_minor = excluded.confirmed_unit_cost_minor;
    end if;
  end loop;

  if (p ->> 'fully_confirmed')::boolean then
    update public.purchase_orders set status = 'confirmed' where id = po and status in ('draft', 'sent');
  elsif exists (select 1 from public.purchase_orders where id = po and status = 'draft') then
    update public.purchase_orders set status = 'sent' where id = po;
  end if;

  if nullif(p ->> 'response_id', '') is not null then
    update public.supplier_responses
    set status = p ->> 'review_status',
        reviewed_by = case when p ->> 'review_status' = 'accepted' then auth.uid() else reviewed_by end,
        reviewed_at = case when p ->> 'review_status' = 'accepted' then now() else reviewed_at end
    where id = (p ->> 'response_id')::uuid and purchase_order_id = po;
  end if;
end;
$$;

revoke all on function public.apply_supplier_answer(jsonb) from public, anon;
grant execute on function public.apply_supplier_answer(jsonb) to authenticated;

-- ── Audit ───────────────────────────────────────────────────────────────────
create trigger audit after insert or update or delete on public.outbound_emails for each row execute function public.audit_row_change();
create trigger audit after insert or update or delete on public.po_links for each row execute function public.audit_row_change();
create trigger audit after insert or update or delete on public.supplier_responses for each row execute function public.audit_row_change();
create trigger audit after insert or update or delete on public.supplier_response_prices for each row execute function public.audit_row_change('supplier_response_id');
create trigger audit after insert or update or delete on public.chases for each row execute function public.audit_row_change();
create trigger audit after insert or update or delete on public.chase_settings for each row execute function public.audit_row_change('org_id');

-- ── Privileges ──────────────────────────────────────────────────────────────
revoke all on public.outbound_emails, public.po_links, public.supplier_responses, public.supplier_response_prices,
  public.chases, public.chase_settings from anon, authenticated;

grant select, insert on public.outbound_emails to authenticated;
grant select, insert on public.po_links to authenticated;
grant update (revoked_at, revoked_by) on public.po_links to authenticated;
grant select, insert on public.supplier_responses to authenticated;
grant update (status, reviewed_by, reviewed_at, review_note) on public.supplier_responses to authenticated;
grant select, insert on public.supplier_response_prices to authenticated;
grant select, insert on public.chases to authenticated;
grant update (status, last_chased_at, chase_count, resolved_by, resolved_at, resolution_note) on public.chases to authenticated;
grant select on public.chase_settings to authenticated;
grant update (amber_hours, red_hours, alert_hours, day_start_hour, day_end_hour, updated_by) on public.chase_settings to authenticated;

grant all on public.outbound_emails, public.po_links, public.supplier_responses, public.supplier_response_prices,
  public.chases, public.chase_settings to service_role;

-- ── Row-level security ──────────────────────────────────────────────────────
alter table public.outbound_emails enable row level security;
alter table public.po_links enable row level security;
alter table public.supplier_responses enable row level security;
alter table public.supplier_response_prices enable row level security;
alter table public.chases enable row level security;
alter table public.chase_settings enable row level security;

-- Emails to suppliers name the supplier: hidden with suppliers.
create policy outbound_emails_select on public.outbound_emails for select to authenticated
  using (org_id = public.current_org_id() and public.has_permission('supplier.identity.view'));
create policy outbound_emails_insert on public.outbound_emails for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_permission('procurement.manage') and public.has_permission('supplier.identity.view'));

-- Links: through their PO. The public confirm page uses the service role, looked up by hash only.
create policy po_links_select on public.po_links for select to authenticated
  using (exists (select 1 from public.purchase_orders p where p.id = purchase_order_id));
create policy po_links_insert on public.po_links for insert to authenticated
  with check (public.has_permission('procurement.manage') and exists (select 1 from public.purchase_orders p where p.id = purchase_order_id));
create policy po_links_update on public.po_links for update to authenticated
  using (public.has_permission('procurement.manage') and exists (select 1 from public.purchase_orders p where p.id = purchase_order_id))
  with check (exists (select 1 from public.purchase_orders p where p.id = purchase_order_id));

create policy supplier_responses_select on public.supplier_responses for select to authenticated
  using (org_id = public.current_org_id() and public.has_permission('supplier.identity.view'));
create policy supplier_responses_insert on public.supplier_responses for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_permission('procurement.manage') and public.has_permission('supplier.identity.view'));
create policy supplier_responses_update on public.supplier_responses for update to authenticated
  using (org_id = public.current_org_id() and public.has_permission('procurement.manage') and public.has_permission('supplier.identity.view'))
  with check (org_id = public.current_org_id());

create policy supplier_response_prices_select on public.supplier_response_prices for select to authenticated
  using (public.has_permission('costs.view') and exists (select 1 from public.supplier_responses r where r.id = supplier_response_id));
create policy supplier_response_prices_insert on public.supplier_response_prices for insert to authenticated
  with check (public.has_permission('costs.view') and exists (select 1 from public.supplier_responses r where r.id = supplier_response_id));

create policy chases_select on public.chases for select to authenticated
  using (org_id = public.current_org_id() and (
    (kind = 'supplier' and public.has_permission('supplier.identity.view'))
    or (kind = 'internal' and exists (select 1 from public.sales_orders o where o.id = sales_order_id))
  ));
create policy chases_insert on public.chases for insert to authenticated
  with check (org_id = public.current_org_id() and opened_by = auth.uid() and (
    (kind = 'supplier' and public.has_permission('procurement.manage') and public.has_permission('supplier.identity.view'))
    or (kind = 'internal' and public.has_permission('chases.internal')
        and exists (select 1 from public.order_lines l join public.sales_orders o on o.id = l.sales_order_id
                    where l.id = order_line_id and o.id = sales_order_id))
  ));
create policy chases_update on public.chases for update to authenticated
  using (org_id = public.current_org_id() and (
    (kind = 'supplier' and public.has_permission('procurement.manage') and public.has_permission('supplier.identity.view'))
    or (kind = 'internal' and (public.has_permission('procurement.manage') or opened_by = auth.uid())
        and exists (select 1 from public.sales_orders o where o.id = sales_order_id))
  ))
  with check (org_id = public.current_org_id());

create policy chase_settings_select on public.chase_settings for select to authenticated
  using (org_id = public.current_org_id());
create policy chase_settings_update on public.chase_settings for update to authenticated
  using (org_id = public.current_org_id() and public.has_permission('settings.edit'))
  with check (org_id = public.current_org_id());
