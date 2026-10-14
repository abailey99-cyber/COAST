-- 0016_customer_portal.sql
-- Phase 5: what customers see and how COAST talks to them.
--
--   customer_page_settings       per organisation: name and logo customers see (B5), the word for "supplier" (B8),
--                                whether a direct shipment's carrier is shown (spec §5.7), notification limits (spec §5.5)
--   order_messages               the two-way conversation on an order
--   customer_notification_prefs  per order: who hears about it and how much
--   customer_notifications       every notification COAST wrote, sent, held back or skipped
--   customer_accounts (+ orders) customer logins and the orders they've added by tracking code (E4)
--   rate_limit_hits              counters for public endpoints (spec §11, B7)
--
-- Customers never query these tables themselves: every customer page is
-- built on the server through the masking function, with the service role,
-- scoped by a tracking code or the signed-in customer's own account.

-- ── New permission: talk to customers ───────────────────────────────────────
insert into public.permissions (key, sort_order) values ('customers.manage', 319);
insert into public.permission_defaults (role, permission) values
  ('procurement', 'customers.manage'), ('sales_manager', 'customers.manage'), ('sales', 'customers.manage');
insert into public.role_permissions (org_id, role, permission, granted_by)
select o.id, d.role, d.permission, null
from public.organisations o join public.permission_defaults d on d.permission = 'customers.manage'
on conflict do nothing;

-- ── Customer page settings ──────────────────────────────────────────────────
create table public.customer_page_settings (
  org_id                 uuid primary key references public.organisations (id) on delete cascade,
  display_name           text check (length(btrim(display_name)) between 1 and 120),
  logo_url               text check (logo_url ~ '^https://[^\s]{4,500}$'),
  supplier_word          text not null default 'shipper' check (supplier_word ~ '^[a-z][a-z -]{1,23}$'),
  show_direct_carrier    boolean not null default false,
  notify_min_gap_hours   integer not null default 4 check (notify_min_gap_hours between 0 and 72),
  notify_date_shift_days integer not null default 2 check (notify_date_shift_days between 0 and 30),
  updated_by             uuid references auth.users (id) on delete set null,
  updated_at             timestamptz not null default now()
);

create trigger customer_page_settings_set_updated_at before update on public.customer_page_settings for each row execute function public.set_updated_at();

create function public.seed_customer_page_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.customer_page_settings (org_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.seed_customer_page_settings() from public, anon, authenticated;
create trigger organisations_seed_customer_page_settings after insert on public.organisations for each row execute function public.seed_customer_page_settings();
insert into public.customer_page_settings (org_id) select id from public.organisations on conflict do nothing;

-- ── Messages ────────────────────────────────────────────────────────────────
create table public.order_messages (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organisations (id) on delete cascade,
  sales_order_id  uuid not null,
  author_kind     text not null check (author_kind in ('customer', 'staff')),
  staff_id        uuid references public.staff_users (id) on delete set null,
  customer_name   text check (length(customer_name) <= 120),
  body            text not null check (length(btrim(body)) between 1 and 4000),
  read_at         timestamptz,
  read_by         uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  foreign key (sales_order_id, org_id) references public.sales_orders (id, org_id) on delete cascade,
  check ((author_kind = 'staff' and staff_id is not null) or author_kind = 'customer')
);

create index order_messages_order_idx on public.order_messages (sales_order_id, created_at);
create index order_messages_unread_idx on public.order_messages (org_id) where author_kind = 'customer' and read_at is null;

-- ── Notification preferences and log ────────────────────────────────────────
create table public.customer_notification_prefs (
  sales_order_id  uuid primary key references public.sales_orders (id) on delete cascade,
  email           text check (email is null or (position('@' in email) > 1 and length(email) <= 254)),
  level           text not null default 'milestones' check (level in ('everything', 'milestones', 'problems', 'replies')),
  daily_digest    boolean not null default false,
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now()
);

create trigger customer_notification_prefs_set_updated_at before update on public.customer_notification_prefs for each row execute function public.set_updated_at();

create table public.customer_notifications (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organisations (id) on delete cascade,
  sales_order_id  uuid not null,
  kind            text not null check (kind in ('milestone', 'date_change', 'problem', 'reply', 'digest')),
  topic           text not null check (length(topic) between 1 and 60),
  summary         text not null check (length(summary) between 1 and 500),
  to_address      text,
  subject         text,
  body_text       text,
  body_html       text,
  channel         text check (channel in ('log', 'm365')),
  -- logged/sent/failed: written (and sent, once email is connected); held: waiting for the throttle or the
  -- daily summary; folded: included in a later notification; skipped: not wanted at this preference level.
  status          text not null check (status in ('logged', 'sent', 'failed', 'held', 'folded', 'skipped')),
  reason          text check (length(reason) <= 300),
  created_at      timestamptz not null default now(),
  foreign key (sales_order_id, org_id) references public.sales_orders (id, org_id) on delete cascade
);

create index customer_notifications_order_idx on public.customer_notifications (sales_order_id, created_at desc);
create index customer_notifications_held_idx on public.customer_notifications (status, created_at) where status = 'held';

-- ── Customer accounts ───────────────────────────────────────────────────────
create table public.customer_accounts (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  org_id      uuid not null references public.organisations (id) on delete cascade,
  customer_id uuid not null,
  full_name   text not null check (length(btrim(full_name)) between 1 and 120),
  email       text not null check (position('@' in email) > 1),
  invited_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  foreign key (customer_id, org_id) references public.customers (id, org_id) on delete cascade
);

create index customer_accounts_customer_idx on public.customer_accounts (customer_id);

create table public.customer_account_orders (
  user_id         uuid not null references public.customer_accounts (user_id) on delete cascade,
  sales_order_id  uuid not null references public.sales_orders (id) on delete cascade,
  added_at        timestamptz not null default now(),
  primary key (user_id, sales_order_id)
);

-- A customer login must never also be a staff login (and vice versa).
create function public.customer_accounts_not_staff()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.staff_users where id = new.user_id) then
    raise exception 'A staff login can''t also be a customer account' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.customer_accounts_not_staff() from public, anon, authenticated;
create trigger customer_accounts_not_staff before insert or update on public.customer_accounts for each row execute function public.customer_accounts_not_staff();

-- ── Rate limits for public endpoints ────────────────────────────────────────
create table public.rate_limit_hits (
  bucket        text not null check (length(bucket) between 1 and 200),
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (bucket, window_start)
);

-- Counts one hit; true while the bucket is within its limit for the current window.
create function public.hit_rate_limit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into public.rate_limit_hits (bucket, window_start, hits) values (p_bucket, w, 1)
  on conflict (bucket, window_start) do update set hits = public.rate_limit_hits.hits + 1
  returning hits into n;
  -- Tidy old windows now and then.
  if random() < 0.01 then delete from public.rate_limit_hits where window_start < now() - interval '1 day'; end if;
  return n <= p_limit;
end;
$$;
revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

-- ── A new tracking code (the old one stops working) ─────────────────────────
grant update (tracking_code) on public.sales_orders to authenticated;

create function public.regenerate_tracking_code(p_order uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  code text;
begin
  update public.sales_orders set tracking_code = public.new_tracking_code() where id = p_order returning tracking_code into code;
  return code;
end;
$$;
revoke all on function public.regenerate_tracking_code(uuid) from public, anon;
grant execute on function public.regenerate_tracking_code(uuid) to authenticated;

-- ── Order history ───────────────────────────────────────────────────────────
alter table public.order_events drop constraint order_events_kind_check;
alter table public.order_events add constraint order_events_kind_check check (kind in (
  'order_created', 'line_stage_changed', 'po_raised', 'po_status_changed', 'order_updated', 'line_added', 'line_updated',
  'po_emailed', 'supplier_responded', 'chase_opened', 'chase_chased', 'chase_resolved',
  'shipment_added', 'shipment_status_changed', 'prediction_changed',
  'customer_message', 'staff_reply', 'customer_notified'
));

create function public.order_events_on_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.order_events (sales_order_id, kind, detail, actor_id)
  values (new.sales_order_id, case when new.author_kind = 'customer' then 'customer_message' else 'staff_reply' end,
          jsonb_build_object('message_id', new.id), case when new.author_kind = 'staff' then new.staff_id end);
  return new;
end;
$$;

create function public.order_events_on_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('logged', 'sent') then
    insert into public.order_events (sales_order_id, kind, detail, actor_id)
    values (new.sales_order_id, 'customer_notified', jsonb_build_object('notification_id', new.id, 'kind', new.kind, 'topic', new.topic, 'status', new.status), null);
  end if;
  return new;
end;
$$;

revoke all on function public.order_events_on_message() from public, anon, authenticated;
revoke all on function public.order_events_on_notification() from public, anon, authenticated;
create trigger order_messages_event after insert on public.order_messages for each row execute function public.order_events_on_message();
create trigger customer_notifications_event after insert or update of status on public.customer_notifications for each row execute function public.order_events_on_notification();

-- ── Audit ───────────────────────────────────────────────────────────────────
create trigger audit after insert or update or delete on public.customer_page_settings for each row execute function public.audit_row_change('org_id');
create trigger audit after insert or update or delete on public.order_messages for each row execute function public.audit_row_change();
create trigger audit after insert or update or delete on public.customer_notification_prefs for each row execute function public.audit_row_change('sales_order_id');
create trigger audit after insert or update or delete on public.customer_accounts for each row execute function public.audit_row_change('user_id');
create trigger audit after insert or update or delete on public.customer_account_orders for each row execute function public.audit_row_change('user_id', 'sales_order_id');

-- ── Privileges ──────────────────────────────────────────────────────────────
revoke all on public.customer_page_settings, public.order_messages, public.customer_notification_prefs, public.customer_notifications,
  public.customer_accounts, public.customer_account_orders, public.rate_limit_hits from anon, authenticated;

grant select on public.customer_page_settings to authenticated;
grant update (display_name, logo_url, supplier_word, show_direct_carrier, notify_min_gap_hours, notify_date_shift_days, updated_by) on public.customer_page_settings to authenticated;
grant select, insert on public.order_messages to authenticated;
grant update (read_at, read_by) on public.order_messages to authenticated;
grant select, insert on public.customer_notification_prefs to authenticated;
grant update (email, level, daily_digest, updated_by) on public.customer_notification_prefs to authenticated;
grant select on public.customer_notifications to authenticated;
grant select on public.customer_accounts, public.customer_account_orders to authenticated;

grant all on public.customer_page_settings, public.order_messages, public.customer_notification_prefs, public.customer_notifications,
  public.customer_accounts, public.customer_account_orders, public.rate_limit_hits to service_role;

-- ── Row-level security ──────────────────────────────────────────────────────
alter table public.customer_page_settings enable row level security;
alter table public.order_messages enable row level security;
alter table public.customer_notification_prefs enable row level security;
alter table public.customer_notifications enable row level security;
alter table public.customer_accounts enable row level security;
alter table public.customer_account_orders enable row level security;
alter table public.rate_limit_hits enable row level security;
-- rate_limit_hits: no policies — only the service role touches it.

create policy customer_page_settings_select on public.customer_page_settings for select to authenticated
  using (org_id = public.current_org_id());
create policy customer_page_settings_update on public.customer_page_settings for update to authenticated
  using (org_id = public.current_org_id() and public.has_permission('settings.edit'))
  with check (org_id = public.current_org_id());

-- Messages: anyone who can see the order reads them; replying needs customers.manage.
create policy order_messages_select on public.order_messages for select to authenticated
  using (org_id = public.current_org_id() and exists (select 1 from public.sales_orders o where o.id = sales_order_id));
create policy order_messages_insert on public.order_messages for insert to authenticated
  with check (org_id = public.current_org_id() and author_kind = 'staff' and staff_id = auth.uid()
              and public.has_permission('customers.manage')
              and exists (select 1 from public.sales_orders o where o.id = sales_order_id));
create policy order_messages_update on public.order_messages for update to authenticated
  using (org_id = public.current_org_id() and public.has_permission('customers.manage')
         and exists (select 1 from public.sales_orders o where o.id = sales_order_id))
  with check (org_id = public.current_org_id());

create policy customer_notification_prefs_select on public.customer_notification_prefs for select to authenticated
  using (exists (select 1 from public.sales_orders o where o.id = sales_order_id));
create policy customer_notification_prefs_insert on public.customer_notification_prefs for insert to authenticated
  with check (public.has_permission('customers.manage') and exists (select 1 from public.sales_orders o where o.id = sales_order_id));
create policy customer_notification_prefs_update on public.customer_notification_prefs for update to authenticated
  using (public.has_permission('customers.manage') and exists (select 1 from public.sales_orders o where o.id = sales_order_id))
  with check (exists (select 1 from public.sales_orders o where o.id = sales_order_id));

create policy customer_notifications_select on public.customer_notifications for select to authenticated
  using (org_id = public.current_org_id() and exists (select 1 from public.sales_orders o where o.id = sales_order_id));

create policy customer_accounts_select on public.customer_accounts for select to authenticated
  using (org_id = public.current_org_id());
create policy customer_account_orders_select on public.customer_account_orders for select to authenticated
  using (exists (select 1 from public.sales_orders o where o.id = sales_order_id));
