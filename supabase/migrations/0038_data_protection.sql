-- 0038_data_protection.sql
-- Readiness plan Task 6.
--
--   order_meter            each sales order counted once, in the UK calendar
--                          month it was first seen (created, or synced later)
--   data_settings          per organisation: how long customer contact details
--                          and message text on closed orders are kept
--   security_text_columns  for the personal-data test: every column whose name
--                          suggests it could hold personal data

-- ── Metering ────────────────────────────────────────────────────────────────
create table public.order_meter (
  sales_order_id  uuid primary key references public.sales_orders (id) on delete cascade,
  org_id          uuid not null references public.organisations (id) on delete cascade,
  month           text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  first_seen_at   timestamptz not null
);
create index order_meter_org_month_idx on public.order_meter (org_id, month);

create function public.meter_sales_order()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Once per order: a later re-sync of the same order doesn't count again.
  insert into public.order_meter (sales_order_id, org_id, month, first_seen_at)
  values (new.id, new.org_id, to_char(new.created_at at time zone 'Europe/London', 'YYYY-MM'), new.created_at)
  on conflict (sales_order_id) do nothing;
  return new;
end;
$$;
revoke all on function public.meter_sales_order() from public, anon, authenticated;
create trigger sales_orders_meter after insert on public.sales_orders for each row execute function public.meter_sales_order();

insert into public.order_meter (sales_order_id, org_id, month, first_seen_at)
select id, org_id, to_char(created_at at time zone 'Europe/London', 'YYYY-MM'), created_at from public.sales_orders
on conflict do nothing;

-- ── Retention ───────────────────────────────────────────────────────────────
create table public.data_settings (
  org_id             uuid primary key references public.organisations (id) on delete cascade,
  -- Months after an order closes that customer contact details and message text are kept. Null: kept.
  retention_months   integer check (retention_months between 1 and 120),
  -- Off until an admin has looked at the dry-run report and switched it on.
  retention_enforced boolean not null default false,
  updated_by         uuid references auth.users (id) on delete set null,
  updated_at         timestamptz not null default now()
);
create trigger data_settings_set_updated_at before update on public.data_settings for each row execute function public.set_updated_at();
create trigger audit after insert or update or delete on public.data_settings for each row execute function public.audit_row_change('org_id');

create function public.seed_data_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.data_settings (org_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.seed_data_settings() from public, anon, authenticated;
create trigger organisations_seed_data_settings after insert on public.organisations for each row execute function public.seed_data_settings();
insert into public.data_settings (org_id) select id from public.organisations on conflict do nothing;

-- Records cleared under retention keep the order; only what's personal goes.
alter table public.order_messages add column redacted_at timestamptz;

-- ── For the personal-data test ──────────────────────────────────────────────
create function public.security_text_columns()
returns table (table_name text, column_name text)
language sql stable security definer set search_path = '' as $$
  select c.table_name::text, c.column_name::text
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.column_name ~ '(email|name|phone|address|body|description|reporter|sender|from_address|to_address|line1|line2|town|postcode|note|subject|raw_text|known_senders)'
  order by 1, 2;
$$;
revoke all on function public.security_text_columns() from public, anon, authenticated;
grant execute on function public.security_text_columns() to service_role;

-- ── Privileges ──────────────────────────────────────────────────────────────
revoke all on public.order_meter, public.data_settings from anon, authenticated;
grant select on public.order_meter to authenticated;
grant select on public.data_settings to authenticated;
grant update (retention_months, retention_enforced, updated_by) on public.data_settings to authenticated;
grant all on public.order_meter, public.data_settings to service_role;

alter table public.order_meter enable row level security;
alter table public.data_settings enable row level security;

create policy order_meter_select on public.order_meter for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.is_admin()));
create policy data_settings_select on public.data_settings for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('section.settings')));
create policy data_settings_update on public.data_settings for update to authenticated
  using (org_id = (select public.current_org_id()) and (select public.is_admin()))
  with check (org_id = (select public.current_org_id()));
