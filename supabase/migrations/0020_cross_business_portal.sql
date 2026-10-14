-- 0020_cross_business_portal.sql
-- The customer portal becomes one COAST account across every business a
-- customer buys from (product-owner decision, 14 October 2026).
--
--   customer_accounts          no longer belongs to one business
--   customer_account_links     a business vouching for a person as one of its customers:
--                              that customer's orders are added to the account automatically
--   leads                      "Get COAST for your business" sign-ups (register interest)
--
-- Automatic adding happens only when a business vouches for the person
-- (an invitation from staff). A tracking code alone only ever adds that
-- one order, so a forwarded link can't expose a customer's future orders.

-- ── Links: a business vouches for a person ──────────────────────────────────
create table public.customer_account_links (
  user_id      uuid not null references public.customer_accounts (user_id) on delete cascade,
  org_id       uuid not null references public.organisations (id) on delete cascade,
  customer_id  uuid not null,
  vouched_by   uuid references auth.users (id) on delete set null,
  vouched_at   timestamptz not null default now(),
  primary key (user_id, customer_id),
  foreign key (customer_id, org_id) references public.customers (id, org_id) on delete cascade
);

create index customer_account_links_customer_idx on public.customer_account_links (customer_id);

-- Existing invited accounts keep their business link.
insert into public.customer_account_links (user_id, org_id, customer_id, vouched_by, vouched_at)
select user_id, org_id, customer_id, invited_by, created_at from public.customer_accounts where invited_by is not null
on conflict do nothing;

-- Accounts no longer belong to one business.
drop policy customer_accounts_select on public.customer_accounts;
alter table public.customer_accounts drop column org_id, drop column customer_id, drop column invited_by;

-- Staff see the accounts linked to their customers, or that have added one of their orders.
create policy customer_accounts_select on public.customer_accounts for select to authenticated
  using (
    exists (select 1 from public.customer_account_links l where l.user_id = customer_accounts.user_id and l.org_id = (select public.current_org_id()))
    or exists (select 1 from public.customer_account_orders ao join public.sales_orders o on o.id = ao.sales_order_id where ao.user_id = customer_accounts.user_id)
  );

-- New orders for a vouched-for customer go straight into their account.
create function public.customer_account_auto_add()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.customer_account_orders (user_id, sales_order_id)
  select l.user_id, new.id from public.customer_account_links l where l.customer_id = new.customer_id and l.org_id = new.org_id
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.customer_account_auto_add() from public, anon, authenticated;
create trigger sales_orders_customer_account_auto_add after insert on public.sales_orders for each row execute function public.customer_account_auto_add();

-- When a business vouches for someone, that customer's existing orders (last year) are added too.
create function public.customer_account_link_backfill()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.customer_account_orders (user_id, sales_order_id)
  select new.user_id, o.id from public.sales_orders o
  where o.customer_id = new.customer_id and o.org_id = new.org_id and o.created_at > now() - interval '1 year'
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.customer_account_link_backfill() from public, anon, authenticated;
create trigger customer_account_links_backfill after insert on public.customer_account_links for each row execute function public.customer_account_link_backfill();

create trigger audit after insert or update or delete on public.customer_account_links for each row execute function public.audit_row_change('user_id', 'customer_id');

revoke all on public.customer_account_links from anon, authenticated;
grant select on public.customer_account_links to authenticated;
grant all on public.customer_account_links to service_role;
alter table public.customer_account_links enable row level security;
create policy customer_account_links_select on public.customer_account_links for select to authenticated
  using (org_id = (select public.current_org_id()));

-- ── Leads: "Get COAST for your business" ────────────────────────────────────
-- COAST's own data, not any business's: service role only (read with npm run leads).
create table public.leads (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) between 1 and 120),
  company        text not null check (length(btrim(company)) between 1 and 200),
  email          text not null check (position('@' in email) > 1 and length(email) <= 254),
  phone          text check (length(phone) <= 40),
  company_size   text check (company_size in ('1-10', '11-50', '51-200', '201+')),
  message        text check (length(message) <= 2000),
  source         text not null check (source in ('tracking_page', 'customer_portal', 'website')),
  -- The business whose tracking page sent them, when there was one.
  referrer_org   uuid references public.organisations (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index leads_created_idx on public.leads (created_at desc);

revoke all on public.leads from anon, authenticated;
grant all on public.leads to service_role;
alter table public.leads enable row level security;
-- No policies: nobody but the service role reads or writes leads.
