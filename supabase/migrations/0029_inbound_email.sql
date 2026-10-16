-- 0029_inbound_email.sql
-- Readiness plan Task 3: supplier replies arriving by email.
--
--   inbound_addresses   each organisation's own forwarding address (random,
--                       unguessable) and the domains its mail must be
--                       forwarded from
--   inbound_messages    every email that arrived, and what became of it
--   m365_sync_state     where COAST got to reading each connected mailbox
--   suppliers.known_senders   other addresses a supplier's replies come from
--   supplier_responses.undone_at   a date that applied itself, then undone

-- ── Addresses ───────────────────────────────────────────────────────────────
create table public.inbound_addresses (
  org_id           uuid primary key references public.organisations (id) on delete cascade,
  -- Made here, never chosen by a person: 120 random bits.
  local_part       text not null unique default ('r-' || substr(encode(extensions.gen_random_bytes(16), 'hex'), 1, 30))
                   check (local_part ~ '^r-[0-9a-f]{30}$'),
  allowed_domains  text[] not null default '{}' check (array_length(allowed_domains, 1) is null or array_length(allowed_domains, 1) <= 10),
  created_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger inbound_addresses_set_updated_at before update on public.inbound_addresses for each row execute function public.set_updated_at();

-- ── Messages ────────────────────────────────────────────────────────────────
create table public.inbound_messages (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organisations (id) on delete cascade,
  channel               text not null check (channel in ('forward', 'm365')),
  message_id            text not null check (length(message_id) between 1 and 500),
  received_at           timestamptz not null default now(),
  from_address          text check (length(from_address) <= 320),
  envelope_sender       text check (length(envelope_sender) <= 320),
  subject               text check (length(subject) <= 1000),
  body                  text check (length(body) <= 50000),
  auth                  jsonb not null default '{}'::jsonb,
  status                text not null check (status in ('applied', 'review', 'quarantined', 'unmatched', 'ignored')),
  reason                text check (length(reason) <= 1000),
  purchase_order_id     uuid,
  supplier_response_id  uuid references public.supplier_responses (id) on delete set null,
  unique (org_id, message_id),
  foreign key (purchase_order_id, org_id) references public.purchase_orders (id, org_id) on delete set null (purchase_order_id)
);

create index inbound_messages_org_idx on public.inbound_messages (org_id, received_at desc);

-- One Microsoft 365 mailbox read per organisation: where COAST got to.
create table public.m365_sync_state (
  org_id       uuid primary key references public.organisations (id) on delete cascade,
  delta_link   text check (length(delta_link) <= 4000),
  last_run_at  timestamptz,
  last_error   text check (length(last_error) <= 500)
);

alter table public.suppliers add column known_senders text[] not null default '{}'
  check (array_length(known_senders, 1) is null or array_length(known_senders, 1) <= 20);
grant update (known_senders) on public.suppliers to authenticated;

alter table public.supplier_responses add column undone_at timestamptz;
alter table public.supplier_responses add column undone_by uuid references auth.users (id) on delete set null;

-- ── Audit ───────────────────────────────────────────────────────────────────
create trigger audit after insert or update or delete on public.inbound_addresses for each row execute function public.audit_row_change('org_id');

-- ── Privileges ──────────────────────────────────────────────────────────────
revoke all on public.inbound_addresses, public.inbound_messages, public.m365_sync_state from anon, authenticated;
grant select on public.inbound_addresses to authenticated;
grant insert (org_id, allowed_domains) on public.inbound_addresses to authenticated;
grant update (allowed_domains) on public.inbound_addresses to authenticated;
grant delete on public.inbound_addresses to authenticated;
grant select on public.inbound_messages to authenticated;
grant update (status, reason, purchase_order_id, supplier_response_id) on public.inbound_messages to authenticated;
grant all on public.inbound_addresses, public.inbound_messages, public.m365_sync_state to service_role;

alter table public.inbound_addresses enable row level security;
alter table public.inbound_messages enable row level security;
alter table public.m365_sync_state enable row level security;

-- Settings viewers see the address; only admins create, change or delete it (deleting it stops mail arriving).
create policy inbound_addresses_select on public.inbound_addresses for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('section.settings')));
create policy inbound_addresses_insert on public.inbound_addresses for insert to authenticated
  with check (org_id = (select public.current_org_id()) and (select public.is_admin()));
create policy inbound_addresses_update on public.inbound_addresses for update to authenticated
  using (org_id = (select public.current_org_id()) and (select public.is_admin()))
  with check (org_id = (select public.current_org_id()));
create policy inbound_addresses_delete on public.inbound_addresses for delete to authenticated
  using (org_id = (select public.current_org_id()) and (select public.is_admin()));

-- Emails are procurement's to read and sort out.
create policy inbound_messages_select on public.inbound_messages for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('procurement.manage')));
create policy inbound_messages_update on public.inbound_messages for update to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('procurement.manage')))
  with check (org_id = (select public.current_org_id()));
-- m365_sync_state: no policies — service role only.
