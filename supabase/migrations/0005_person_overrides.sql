-- 0005_person_overrides.sql
-- Per-person access (product-owner decision E7):
--   * the "Manage sales reps' access" permission and the Sales manager's defaults
--   * staff_permission_overrides: one person allowed something extra, or
--     blocked from something, on top of their role
--   * has_permission() now applies a person's overrides
--
-- Who can set an override is decided by can_manage_person_access(), which
-- mirrors canManagePersonAccess() + grantablePermissions() in
-- src/lib/logic/permissions.ts:
--   - nobody changes their own access, and nobody changes an admin's
--   - admins can change anyone else, for any permission
--   - holders of people.manage_sales can change sales reps only, and only for
--     permissions they hold themselves — never people.manage_sales itself

-- ── New permission and defaults ─────────────────────────────────────────────
insert into public.permissions (key, sort_order) values ('people.manage_sales', 340);

insert into public.permission_defaults (role, permission) values
  ('sales_manager', 'section.orders'),
  ('sales_manager', 'section.chases'),
  ('sales_manager', 'section.updates'),
  ('sales_manager', 'section.metrics'),
  ('sales_manager', 'section.settings'),
  ('sales_manager', 'orders.view_all'),
  ('sales_manager', 'supplier.identity.view'),
  ('sales_manager', 'costs.view'),
  ('sales_manager', 'people.manage_sales');

-- Backfill: existing organisations get the Sales manager defaults.
insert into public.role_permissions (org_id, role, permission, granted_by)
select o.id, d.role, d.permission, null
from public.organisations o
join public.permission_defaults d on d.role = 'sales_manager'
on conflict do nothing;

-- ── Per-person overrides ────────────────────────────────────────────────────
-- Scoped to an organisation through the person's staff_users row (no
-- redundant org_id — CLAUDE.md non-negotiable 7).
create table public.staff_permission_overrides (
  user_id     uuid not null references public.staff_users (id) on delete cascade,
  permission  text not null references public.permissions (key) on delete cascade,
  granted     boolean not null,
  set_by      uuid default auth.uid() references auth.users (id) on delete set null,
  set_at      timestamptz not null default now(),
  primary key (user_id, permission)
);

-- ── has_permission() now applies overrides ──────────────────────────────────
create or replace function public.has_permission(p text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.current_staff_role() is null then false
    when public.current_staff_role() = 'admin' then exists (select 1 from public.permissions where key = p)
    else coalesce(
      (select o.granted from public.staff_permission_overrides o where o.user_id = auth.uid() and o.permission = p),
      exists (
        select 1 from public.role_permissions rp
        where rp.org_id = public.current_org_id()
          and rp.role = public.current_staff_role()
          and rp.permission = p
      )
    )
  end
$$;

create function public.can_manage_person_access(target uuid, p text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_users t
    where t.id = target
      and t.org_id = public.current_org_id()
      and t.id <> auth.uid()
      and t.role <> 'admin'
      and (
        public.is_admin()
        or (
          t.role = 'sales'
          and p <> 'people.manage_sales'
          and public.has_permission('people.manage_sales')
          and public.has_permission(p)
        )
      )
  )
$$;

revoke all on function public.can_manage_person_access(uuid, text) from public, anon;
grant execute on function public.can_manage_person_access(uuid, text) to authenticated;

-- ── Privileges ──────────────────────────────────────────────────────────────
revoke all on public.staff_permission_overrides from anon, authenticated;
grant select, insert, delete on public.staff_permission_overrides to authenticated;
grant update (granted) on public.staff_permission_overrides to authenticated;
grant all on public.staff_permission_overrides to service_role;

-- ── Row-level security ──────────────────────────────────────────────────────
alter table public.staff_permission_overrides enable row level security;

create policy staff_permission_overrides_select_same_org
  on public.staff_permission_overrides for select to authenticated
  using (exists (select 1 from public.staff_users s where s.id = user_id and s.org_id = public.current_org_id()));

create policy staff_permission_overrides_insert
  on public.staff_permission_overrides for insert to authenticated
  with check (public.can_manage_person_access(user_id, permission) and set_by = auth.uid());

create policy staff_permission_overrides_update
  on public.staff_permission_overrides for update to authenticated
  using (public.can_manage_person_access(user_id, permission))
  with check (public.can_manage_person_access(user_id, permission));

create policy staff_permission_overrides_delete
  on public.staff_permission_overrides for delete to authenticated
  using (public.can_manage_person_access(user_id, permission));
