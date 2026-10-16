-- Phase 7b, step 1: Branches (docs/03-branches-and-projects.md).
--
-- A branch is one of the business's own selling locations. It decides which
-- sales staff can see an order; it is never shown to customers. This step is
-- additive only: every organisation gets one default branch, every order and
-- every sales rep is put in it, and nobody's visible orders change. The
-- security rules come in step 2 (0041), the screens in step 4.
--
--   branches               the business's selling locations
--   user_branch_access     extra branches an admin has granted someone
--   erp_branch_mappings    ERP location/subsidiary/department → branch (Phase 8)
--   sales_orders.branch_id         the selling branch (required)
--   staff_users.home_branch_id     a person's own branch (filled for sales reps)
--   organisations.restrict_sales_to_branch   the switch (default on)
--   permission branches.view_all   "See every branch" (N6)

-- ── Branches ────────────────────────────────────────────────────────────────
create table public.branches (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 100),
  code        text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{0,9}$'),
  address     text check (length(address) <= 500),
  is_active   boolean not null default true,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, code),
  unique (id, org_id),
  -- The default branch is where unassigned orders land, so it can't be switched off.
  check (is_active or not is_default)
);

create unique index branches_one_default_idx on public.branches (org_id) where is_default;
create unique index branches_name_idx on public.branches (org_id, lower(name));

create trigger branches_set_updated_at
  before update on public.branches
  for each row execute function public.set_updated_at();

-- Exactly one default per organisation, checked at the end of the
-- transaction so the default can be moved from one branch to another.
create function public.branches_check_default()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := coalesce(new.org_id, old.org_id);
begin
  if exists (select 1 from public.organisations where id = org)
     and (select count(*) from public.branches where org_id = org and is_default) <> 1 then
    raise exception 'An organisation needs exactly one default branch' using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function public.branches_check_default() from public, anon, authenticated;

-- Every organisation starts with one branch, so single-branch businesses never need to think about it.
create function public.seed_default_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.branches (org_id, name, code, is_default) values (new.id, 'Main branch', 'MAIN', true);
  return new;
end;
$$;
revoke all on function public.seed_default_branch() from public, anon, authenticated;

create trigger organisations_seed_default_branch
  after insert on public.organisations
  for each row execute function public.seed_default_branch();

insert into public.branches (org_id, name, code, is_default)
select o.id, 'Main branch', 'MAIN', true from public.organisations o;

-- The organisation's default branch (null if there somehow isn't one).
create function public.default_branch_id(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.branches where org_id = p_org and is_default
$$;
revoke all on function public.default_branch_id(uuid) from public, anon;
grant execute on function public.default_branch_id(uuid) to authenticated, service_role;

-- ── The switch ──────────────────────────────────────────────────────────────
alter table public.organisations add column restrict_sales_to_branch boolean not null default true;
-- Changed by an admin through the app (step 4), not directly.
revoke update (restrict_sales_to_branch) on public.organisations from authenticated;

-- ── Home branch ─────────────────────────────────────────────────────────────
alter table public.staff_users add column home_branch_id uuid;
alter table public.staff_users
  add constraint staff_users_home_branch_fk foreign key (home_branch_id, org_id) references public.branches (id, org_id);
create index staff_users_home_branch_idx on public.staff_users (home_branch_id);

update public.staff_users s set home_branch_id = public.default_branch_id(s.org_id)
where s.role in ('sales', 'sales_manager') and s.home_branch_id is null;

-- A new sales rep starts in the default branch unless given one; an admin can change it later.
create function public.staff_users_default_home_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.home_branch_id is null and new.role in ('sales', 'sales_manager')
     and (tg_op = 'INSERT' or old.role is distinct from new.role) then
    new.home_branch_id := public.default_branch_id(new.org_id);
  end if;
  return new;
end;
$$;
revoke all on function public.staff_users_default_home_branch() from public, anon, authenticated;

create trigger staff_users_default_home_branch
  before insert or update of role on public.staff_users
  for each row execute function public.staff_users_default_home_branch();

-- ── Order branch ────────────────────────────────────────────────────────────
alter table public.sales_orders add column branch_id uuid;

-- The creator's home branch (if active), otherwise the organisation's default.
create function public.sales_orders_default_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.branch_id is null then
    select b.id into new.branch_id
    from public.staff_users s join public.branches b on b.id = s.home_branch_id and b.org_id = s.org_id
    where s.id = coalesce(new.created_by, auth.uid()) and s.org_id = new.org_id and b.is_active;
    if new.branch_id is null then
      new.branch_id := public.default_branch_id(new.org_id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.sales_orders_default_branch() from public, anon, authenticated;

create trigger sales_orders_default_branch
  before insert on public.sales_orders
  for each row execute function public.sales_orders_default_branch();

-- Backfill without touching updated_at (nothing about the order really changed).
alter table public.sales_orders disable trigger sales_orders_set_updated_at;
alter table public.sales_orders disable trigger audit;
update public.sales_orders o set branch_id = public.default_branch_id(o.org_id) where o.branch_id is null;
alter table public.sales_orders enable trigger audit;
alter table public.sales_orders enable trigger sales_orders_set_updated_at;

alter table public.sales_orders alter column branch_id set not null;
alter table public.sales_orders
  add constraint sales_orders_branch_fk foreign key (branch_id, org_id) references public.branches (id, org_id);
create index sales_orders_org_branch_idx on public.sales_orders (org_id, branch_id);

-- ── Extra branches granted to a person ──────────────────────────────────────
-- org_id is here for integrity, not convenience: the composite keys make it
-- impossible to grant someone a branch in another organisation.
create table public.user_branch_access (
  org_id      uuid not null references public.organisations (id) on delete cascade,
  staff_id    uuid not null,
  branch_id   uuid not null,
  granted_by  uuid references auth.users (id) on delete set null,
  granted_at  timestamptz not null default now(),
  primary key (staff_id, branch_id),
  foreign key (staff_id, org_id) references public.staff_users (id, org_id) on delete cascade,
  foreign key (branch_id, org_id) references public.branches (id, org_id) on delete cascade
);
create index user_branch_access_branch_idx on public.user_branch_access (branch_id);

-- ── ERP mapping (used by the NetSuite sync, Phase 8) ────────────────────────
create table public.erp_branch_mappings (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations (id) on delete cascade,
  source_field  text not null check (source_field in ('location', 'subsidiary', 'department')),
  source_value  text not null check (length(btrim(source_value)) between 1 and 200),
  branch_id     uuid not null,
  created_at    timestamptz not null default now(),
  unique (org_id, source_field, source_value),
  foreign key (branch_id, org_id) references public.branches (id, org_id) on delete cascade
);

-- ── Audit ───────────────────────────────────────────────────────────────────
create trigger audit after insert or update or delete on public.branches for each row execute function public.audit_row_change();
create trigger audit after insert or update or delete on public.user_branch_access for each row execute function public.audit_row_change('staff_id', 'branch_id');
create trigger audit after insert or update or delete on public.erp_branch_mappings for each row execute function public.audit_row_change();

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on public.branches, public.user_branch_access, public.erp_branch_mappings from anon, authenticated;
grant select, insert on public.branches to authenticated;
grant update (name, code, address, is_active, is_default) on public.branches to authenticated;
grant select, insert, delete on public.user_branch_access to authenticated;
grant select, insert, delete on public.erp_branch_mappings to authenticated;
grant update (branch_id) on public.erp_branch_mappings to authenticated;
grant all on public.branches, public.user_branch_access, public.erp_branch_mappings to service_role;
grant update (home_branch_id) on public.staff_users to authenticated;

-- ── Row-level security ──────────────────────────────────────────────────────
alter table public.branches enable row level security;
alter table public.user_branch_access enable row level security;
alter table public.erp_branch_mappings enable row level security;

-- Branch names aren't sensitive inside the business: everyone can see the list (filters, labels).
create policy branches_select on public.branches for select to authenticated
  using (org_id = public.current_org_id());
create policy branches_insert on public.branches for insert to authenticated
  with check (org_id = public.current_org_id() and public.is_admin());
create policy branches_update on public.branches for update to authenticated
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id());

-- Who has which extra branch: the person themselves, and admins.
create policy user_branch_access_select on public.user_branch_access for select to authenticated
  using (org_id = public.current_org_id() and (staff_id = auth.uid() or public.is_admin()));
create policy user_branch_access_insert on public.user_branch_access for insert to authenticated
  with check (org_id = public.current_org_id() and public.is_admin() and granted_by = auth.uid());
create policy user_branch_access_delete on public.user_branch_access for delete to authenticated
  using (org_id = public.current_org_id() and public.is_admin());

create policy erp_branch_mappings_select on public.erp_branch_mappings for select to authenticated
  using (org_id = public.current_org_id());
create policy erp_branch_mappings_insert on public.erp_branch_mappings for insert to authenticated
  with check (org_id = public.current_org_id() and public.is_admin());
create policy erp_branch_mappings_update on public.erp_branch_mappings for update to authenticated
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id());
create policy erp_branch_mappings_delete on public.erp_branch_mappings for delete to authenticated
  using (org_id = public.current_org_id() and public.is_admin());

-- ── New permission: see every branch (N6) ───────────────────────────────────
insert into public.permissions (key, sort_order) values ('branches.view_all', 240);
insert into public.permission_defaults (role, permission) values
  ('procurement', 'branches.view_all'),
  ('director', 'branches.view_all'),
  ('sales_manager', 'branches.view_all');
insert into public.role_permissions (org_id, role, permission, granted_by)
select o.id, d.role, d.permission, null
from public.organisations o join public.permission_defaults d on d.permission = 'branches.view_all'
on conflict do nothing;

-- Last, so this migration's own inserts don't leave checks pending while it alters tables.
create constraint trigger branches_one_default
  after insert or update or delete on public.branches
  deferrable initially deferred
  for each row execute function public.branches_check_default();
