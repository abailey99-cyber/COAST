-- 0003_permissions.sql
-- Who sees what, set per organisation by its admins (product-owner decision
-- E2). Replaces the fixed role rules from 0001.
--
--   permissions          the list of switchable permissions (keys only;
--                        labels are UI copy in src/lib/logic/permissions.ts)
--   permission_defaults  what each role starts with in a new organisation
--   role_permissions     what each role actually has, per organisation.
--                        A row means "granted"; no row means "denied".
--
-- Admin always has every permission and has no rows here, so an
-- organisation can never lock itself out. Only admins change permissions.
--
-- Keep the keys and defaults identical to src/lib/logic/permissions.ts —
-- tests/rls/isolation.test.ts fails if they drift. A later migration that
-- adds a permission must insert it here, add its defaults, and backfill
-- role_permissions for existing organisations.

create table public.permissions (
  key         text primary key check (key ~ '^[a-z_]+(\.[a-z_-]+)+$'),
  sort_order  integer not null unique
);

create table public.permission_defaults (
  role        public.staff_role not null check (role <> 'admin'),
  permission  text not null references public.permissions (key) on delete cascade,
  primary key (role, permission)
);

create table public.role_permissions (
  org_id      uuid not null references public.organisations (id) on delete cascade,
  role        public.staff_role not null check (role <> 'admin'),
  permission  text not null references public.permissions (key) on delete cascade,
  granted_by  uuid default auth.uid() references auth.users (id) on delete set null,
  granted_at  timestamptz not null default now(),
  primary key (org_id, role, permission)
);

-- ── The permission list ─────────────────────────────────────────────────────
insert into public.permissions (key, sort_order) values
  ('section.orders', 10),
  ('section.purchase-orders', 20),
  ('section.review-queue', 30),
  ('section.chases', 40),
  ('section.shipments', 50),
  ('section.suppliers', 60),
  ('section.goods-in', 70),
  ('section.updates', 80),
  ('section.metrics', 90),
  ('section.settings', 100),
  ('orders.view_all', 200),
  ('supplier.identity.view', 210),
  ('costs.view', 220),
  ('orders.edit', 300),
  ('procurement.manage', 310),
  ('goods_in.check', 320),
  ('settings.edit', 330);

-- ── Defaults for a new organisation ─────────────────────────────────────────
-- Procurement: every screen, all data, procurement actions.
insert into public.permission_defaults (role, permission)
select 'procurement', key from public.permissions
where key like 'section.%'
   or key in ('orders.view_all', 'supplier.identity.view', 'costs.view', 'orders.edit', 'procurement.manage', 'goods_in.check');

-- Sales (E1): see all orders, supplier names and costs; no edits (spec §3).
insert into public.permission_defaults (role, permission) values
  ('sales', 'section.orders'),
  ('sales', 'section.chases'),
  ('sales', 'section.updates'),
  ('sales', 'section.metrics'),
  ('sales', 'section.settings'),
  ('sales', 'orders.view_all'),
  ('sales', 'supplier.identity.view'),
  ('sales', 'costs.view');

-- Director (E3): see everything, change nothing.
insert into public.permission_defaults (role, permission)
select 'director', key from public.permissions
where key like 'section.%' or key in ('orders.view_all', 'supplier.identity.view', 'costs.view');

-- Goods-in: their screen, Settings, supplier names (to match deliveries), check-in.
insert into public.permission_defaults (role, permission) values
  ('goods_in', 'section.goods-in'),
  ('goods_in', 'section.settings'),
  ('goods_in', 'supplier.identity.view'),
  ('goods_in', 'goods_in.check');

-- ── Every organisation starts with the defaults ─────────────────────────────
create function public.seed_role_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.role_permissions (org_id, role, permission, granted_by)
  select new.id, d.role, d.permission, null
  from public.permission_defaults d
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function public.seed_role_permissions() from public, anon, authenticated;

create trigger organisations_seed_role_permissions
  after insert on public.organisations
  for each row execute function public.seed_role_permissions();

-- Backfill organisations that already exist.
insert into public.role_permissions (org_id, role, permission, granted_by)
select o.id, d.role, d.permission, null
from public.organisations o
cross join public.permission_defaults d
on conflict do nothing;

-- ── The one check every policy uses ─────────────────────────────────────────
create function public.has_permission(p text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.current_staff_role() is null then false
    when public.current_staff_role() = 'admin' then exists (select 1 from public.permissions where key = p)
    else exists (
      select 1 from public.role_permissions rp
      where rp.org_id = public.current_org_id()
        and rp.role = public.current_staff_role()
        and rp.permission = p
    )
  end
$$;

revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

-- 0001's fixed-role helpers now follow the organisation's permissions.
create or replace function public.can_manage_procurement()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission('procurement.manage')
$$;

-- "Elevated" no longer means anything fixed — policies use has_permission().
drop function public.is_elevated();

-- ── Privileges ──────────────────────────────────────────────────────────────
revoke all on public.permissions, public.permission_defaults, public.role_permissions from anon, authenticated;
grant select on public.permissions, public.permission_defaults to authenticated;
grant select, insert, delete on public.role_permissions to authenticated;
grant all on public.permissions, public.permission_defaults, public.role_permissions to service_role;

-- ── Row-level security ──────────────────────────────────────────────────────
alter table public.permissions enable row level security;
alter table public.permission_defaults enable row level security;
alter table public.role_permissions enable row level security;

create policy permissions_select_all
  on public.permissions for select to authenticated
  using (true);

create policy permission_defaults_select_all
  on public.permission_defaults for select to authenticated
  using (true);

create policy role_permissions_select_same_org
  on public.role_permissions for select to authenticated
  using (org_id = public.current_org_id());

-- Only admins change who sees what, and only in their own organisation.
create policy role_permissions_insert_by_admin
  on public.role_permissions for insert to authenticated
  with check (org_id = public.current_org_id() and public.is_admin() and granted_by = auth.uid());

create policy role_permissions_delete_by_admin
  on public.role_permissions for delete to authenticated
  using (org_id = public.current_org_id() and public.is_admin());
