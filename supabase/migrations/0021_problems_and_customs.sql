-- 0021_problems_and_customs.sql
-- Phase 7: delivery problems (spec §5.4) and customs (spec §5.3).
--
--   delivery_exceptions (+ _lines, _events)   a problem with a delivery, raised by the customer, a carrier,
--                                             goods-in or staff, triaged through to resolution
--   attachments                               photos (decision B13), stored privately in Supabase Storage
--   customs_documents                         per international shipment: what's needed, what's arrived
--   customs_settings                          per organisation: its customs number (EORI), whether
--                                             mainland → Northern Ireland / islands counts as customs (C6)
--   customers.eori                            a customer's customs number
--
-- A problem is visible to anyone who can see its order. What a customer sees
-- of it is built by the masking function from three fields only: category,
-- date and a customer-safe status.

-- ── Permissions ─────────────────────────────────────────────────────────────
insert into public.permissions (key, sort_order) values ('section.problems', 55), ('problems.manage', 317);
insert into public.permission_defaults (role, permission) values
  ('procurement', 'section.problems'), ('procurement', 'problems.manage'),
  ('director', 'section.problems'),
  ('sales', 'section.problems'), ('sales', 'problems.manage'),
  ('sales_manager', 'section.problems'), ('sales_manager', 'problems.manage');
insert into public.role_permissions (org_id, role, permission, granted_by)
select o.id, d.role, d.permission, null
from public.organisations o join public.permission_defaults d on d.permission in ('section.problems', 'problems.manage')
on conflict do nothing;

-- ── Delivery problems ───────────────────────────────────────────────────────
create table public.delivery_exceptions (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organisations (id) on delete cascade,
  sales_order_id       uuid not null,
  shipment_id          uuid references public.shipments (id) on delete set null,
  raised_via           text not null check (raised_via in ('customer', 'carrier', 'goods_in', 'staff')),
  category             text not null check (category in ('damaged', 'short', 'wrong_item', 'not_received', 'late', 'faulty', 'other')),
  -- What was reported, in the reporter's words. The customer sees their own.
  description          text check (length(description) <= 2000),
  reporter_name        text check (length(reporter_name) <= 120),
  status               text not null default 'raised' check (status in ('raised', 'triage', 'waiting_supplier', 'waiting_carrier', 'waiting_customer', 'resolved', 'closed')),
  waiting_since        timestamptz not null default now(),
  owner_id             uuid references public.staff_users (id) on delete set null,
  -- Internal only: never reaches a customer.
  root_cause           text check (length(root_cause) <= 2000),
  resolution           text check (resolution in ('replacement', 'credit', 'return', 'refund', 'no_action')),
  resolution_note      text check (length(resolution_note) <= 2000),
  rma_reference        text check (length(rma_reference) <= 100),
  replacement_line_id  uuid references public.order_lines (id) on delete set null,
  claim_deadline       date,
  claim_submitted_at   timestamptz,
  created_by           uuid references auth.users (id) on delete set null default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  resolved_at          timestamptz,
  closed_at            timestamptz,
  foreign key (sales_order_id, org_id) references public.sales_orders (id, org_id) on delete cascade,
  check ((status in ('resolved', 'closed')) = (resolution is not null) or status = 'closed')
);

create index delivery_exceptions_org_status_idx on public.delivery_exceptions (org_id, status, created_at desc);
create index delivery_exceptions_order_idx on public.delivery_exceptions (sales_order_id);
-- One open carrier-drafted problem per shipment, so polling can't raise it twice.
create unique index delivery_exceptions_one_open_carrier_idx on public.delivery_exceptions (shipment_id)
  where raised_via = 'carrier' and status not in ('resolved', 'closed');

create trigger delivery_exceptions_set_updated_at before update on public.delivery_exceptions for each row execute function public.set_updated_at();

create table public.delivery_exception_lines (
  exception_id   uuid not null references public.delivery_exceptions (id) on delete cascade,
  order_line_id  uuid not null references public.order_lines (id) on delete cascade,
  quantity       numeric(12, 3) check (quantity > 0),
  primary key (exception_id, order_line_id)
);

create table public.delivery_exception_events (
  id            bigint generated always as identity primary key,
  exception_id  uuid not null references public.delivery_exceptions (id) on delete cascade,
  kind          text not null check (kind in ('raised', 'status', 'owner', 'note', 'resolution', 'claim', 'photo')),
  detail        jsonb not null default '{}'::jsonb,
  actor_id      uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);

create index delivery_exception_events_idx on public.delivery_exception_events (exception_id, created_at);

-- Status changes: restart the "waiting since" clock, stamp resolved/closed, write both histories.
create function public.delivery_exceptions_on_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.delivery_exception_events (exception_id, kind, detail, actor_id)
    values (new.id, 'raised', jsonb_build_object('via', new.raised_via, 'category', new.category), auth.uid());
    insert into public.order_events (sales_order_id, kind, detail, actor_id)
    values (new.sales_order_id, 'problem_raised', jsonb_build_object('exception_id', new.id, 'via', new.raised_via, 'category', new.category), auth.uid());
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.delivery_exception_events (exception_id, kind, detail, actor_id)
    values (new.id, 'status', jsonb_build_object('from', old.status, 'to', new.status), auth.uid());
    insert into public.order_events (sales_order_id, kind, detail, actor_id)
    values (new.sales_order_id, 'problem_updated', jsonb_build_object('exception_id', new.id, 'category', new.category, 'from', old.status, 'to', new.status, 'resolution', new.resolution), auth.uid());
  end if;
  if new.owner_id is distinct from old.owner_id then
    insert into public.delivery_exception_events (exception_id, kind, detail, actor_id)
    values (new.id, 'owner', jsonb_build_object('owner_id', new.owner_id), auth.uid());
  end if;
  if new.claim_submitted_at is distinct from old.claim_submitted_at and new.claim_submitted_at is not null then
    insert into public.delivery_exception_events (exception_id, kind, detail, actor_id)
    values (new.id, 'claim', jsonb_build_object('submitted', true), auth.uid());
  end if;
  return new;
end;
$$;

create function public.delivery_exceptions_before_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    new.waiting_since := now();
    if new.status = 'resolved' and new.resolved_at is null then new.resolved_at := now(); end if;
    if new.status = 'closed' and new.closed_at is null then new.closed_at := now(); end if;
    if new.status not in ('resolved', 'closed') then new.resolved_at := null; new.closed_at := null; end if;
  end if;
  return new;
end;
$$;

revoke all on function public.delivery_exceptions_on_change() from public, anon, authenticated;
create trigger delivery_exceptions_before_change before update on public.delivery_exceptions for each row execute function public.delivery_exceptions_before_change();
create trigger delivery_exceptions_on_change after insert or update on public.delivery_exceptions for each row execute function public.delivery_exceptions_on_change();

-- ── Attachments (photos) ────────────────────────────────────────────────────
create table public.attachments (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organisations (id) on delete cascade,
  entity_type       text not null check (entity_type in ('delivery_exception')),
  entity_id         uuid not null,
  storage_path      text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[a-z_]+/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  file_name         text not null check (length(file_name) between 1 and 200),
  content_type      text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes        integer not null check (size_bytes between 1 and 10485760),
  uploaded_by_kind  text not null check (uploaded_by_kind in ('customer', 'staff')),
  uploaded_by       uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now()
);

create index attachments_entity_idx on public.attachments (entity_type, entity_id);

-- Private bucket: nobody reads it directly; COAST hands out short-lived links after checking who's asking.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ── Customs ─────────────────────────────────────────────────────────────────
create table public.customs_settings (
  org_id                    uuid primary key references public.organisations (id) on delete cascade,
  eori                      text check (eori ~ '^[A-Z]{2}[A-Z0-9]{1,15}$'),
  -- Decision C6: does mainland → Northern Ireland / Channel Islands / Isle of Man count as customs? Default yes.
  territories_need_customs  boolean not null default true,
  updated_by                uuid references auth.users (id) on delete set null,
  updated_at                timestamptz not null default now()
);

create trigger customs_settings_set_updated_at before update on public.customs_settings for each row execute function public.set_updated_at();

create function public.seed_customs_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.customs_settings (org_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.seed_customs_settings() from public, anon, authenticated;
create trigger organisations_seed_customs_settings after insert on public.organisations for each row execute function public.seed_customs_settings();
insert into public.customs_settings (org_id) select id from public.organisations on conflict do nothing;

alter table public.customers add column eori text check (eori ~ '^[A-Z]{2}[A-Z0-9]{1,15}$');
grant update (eori) on public.customers to authenticated;

-- A person has confirmed whether customs applies (needed for the mainland → territory cases, spec §5.3).
alter table public.shipments add column customs_confirmed boolean not null default false;
grant update (is_international, customs_confirmed) on public.shipments to authenticated;

create table public.customs_documents (
  shipment_id  uuid not null references public.shipments (id) on delete cascade,
  doc_type     text not null check (doc_type in ('commercial_invoice', 'packing_list', 'certificate_of_origin', 'export_declaration', 'import_declaration', 'dangerous_goods_note', 'other')),
  required     boolean not null default true,
  received_at  timestamptz,
  received_by  uuid references auth.users (id) on delete set null,
  note         text check (length(note) <= 500),
  primary key (shipment_id, doc_type)
);

-- ── Order history ───────────────────────────────────────────────────────────
alter table public.order_events drop constraint order_events_kind_check;
alter table public.order_events add constraint order_events_kind_check check (kind in (
  'order_created', 'line_stage_changed', 'po_raised', 'po_status_changed', 'order_updated', 'line_added', 'line_updated',
  'po_emailed', 'supplier_responded', 'chase_opened', 'chase_chased', 'chase_resolved',
  'shipment_added', 'shipment_status_changed', 'prediction_changed',
  'customer_message', 'staff_reply', 'customer_notified', 'goods_received',
  'problem_raised', 'problem_updated'
));

-- ── Audit ───────────────────────────────────────────────────────────────────
create trigger audit after insert or update or delete on public.delivery_exceptions for each row execute function public.audit_row_change();
create trigger audit after insert or update or delete on public.delivery_exception_lines for each row execute function public.audit_row_change('exception_id', 'order_line_id');
create trigger audit after insert or update or delete on public.attachments for each row execute function public.audit_row_change();
create trigger audit after insert or update or delete on public.customs_settings for each row execute function public.audit_row_change('org_id');
create trigger audit after insert or update or delete on public.customs_documents for each row execute function public.audit_row_change('shipment_id', 'doc_type');

-- ── Privileges ──────────────────────────────────────────────────────────────
revoke all on public.delivery_exceptions, public.delivery_exception_lines, public.delivery_exception_events, public.attachments,
  public.customs_settings, public.customs_documents from anon, authenticated;

grant select, insert on public.delivery_exceptions to authenticated;
grant update (status, owner_id, root_cause, resolution, resolution_note, rma_reference, replacement_line_id, claim_deadline, claim_submitted_at, category, shipment_id)
  on public.delivery_exceptions to authenticated;
grant select, insert on public.delivery_exception_lines to authenticated;
grant select, insert on public.delivery_exception_events to authenticated;
grant select on public.attachments to authenticated;
grant select on public.customs_settings to authenticated;
grant update (eori, territories_need_customs, updated_by) on public.customs_settings to authenticated;
grant select, insert on public.customs_documents to authenticated;
grant update (required, received_at, received_by, note) on public.customs_documents to authenticated;

grant all on public.delivery_exceptions, public.delivery_exception_lines, public.delivery_exception_events, public.attachments,
  public.customs_settings, public.customs_documents to service_role;

-- ── Row-level security ──────────────────────────────────────────────────────
alter table public.delivery_exceptions enable row level security;
alter table public.delivery_exception_lines enable row level security;
alter table public.delivery_exception_events enable row level security;
alter table public.attachments enable row level security;
alter table public.customs_settings enable row level security;
alter table public.customs_documents enable row level security;

create policy delivery_exceptions_select on public.delivery_exceptions for select to authenticated
  using (org_id = (select public.current_org_id()) and exists (select 1 from public.sales_orders o where o.id = sales_order_id));
create policy delivery_exceptions_insert on public.delivery_exceptions for insert to authenticated
  with check (org_id = (select public.current_org_id()) and (select public.has_permission('problems.manage'))
              and raised_via = 'staff' and exists (select 1 from public.sales_orders o where o.id = sales_order_id));
create policy delivery_exceptions_update on public.delivery_exceptions for update to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('problems.manage'))
         and exists (select 1 from public.sales_orders o where o.id = sales_order_id))
  with check (org_id = (select public.current_org_id()));

create policy delivery_exception_lines_select on public.delivery_exception_lines for select to authenticated
  using (exists (select 1 from public.delivery_exceptions e where e.id = exception_id));
create policy delivery_exception_lines_insert on public.delivery_exception_lines for insert to authenticated
  with check ((select public.has_permission('problems.manage'))
              and exists (select 1 from public.delivery_exceptions e join public.order_lines l on l.sales_order_id = e.sales_order_id
                          where e.id = exception_id and l.id = order_line_id));

create policy delivery_exception_events_select on public.delivery_exception_events for select to authenticated
  using (exists (select 1 from public.delivery_exceptions e where e.id = exception_id));
create policy delivery_exception_events_insert on public.delivery_exception_events for insert to authenticated
  with check (kind = 'note' and actor_id = auth.uid() and (select public.has_permission('problems.manage'))
              and exists (select 1 from public.delivery_exceptions e where e.id = exception_id));

-- Photos: listed for anyone who can see the problem; the files themselves only through COAST's short-lived links.
create policy attachments_select on public.attachments for select to authenticated
  using (org_id = (select public.current_org_id())
         and exists (select 1 from public.delivery_exceptions e where e.id = entity_id));

create policy customs_settings_select on public.customs_settings for select to authenticated
  using (org_id = (select public.current_org_id()));
create policy customs_settings_update on public.customs_settings for update to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('settings.edit')))
  with check (org_id = (select public.current_org_id()));

create policy customs_documents_select on public.customs_documents for select to authenticated
  using (exists (select 1 from public.shipments s where s.id = shipment_id));
create policy customs_documents_insert on public.customs_documents for insert to authenticated
  with check ((select public.has_permission('shipments.manage')) and exists (select 1 from public.shipments s where s.id = shipment_id));
create policy customs_documents_update on public.customs_documents for update to authenticated
  using ((select public.has_permission('shipments.manage')) and exists (select 1 from public.shipments s where s.id = shipment_id))
  with check (exists (select 1 from public.shipments s where s.id = shipment_id));
