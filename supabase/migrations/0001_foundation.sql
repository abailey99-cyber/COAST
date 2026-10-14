-- 0001_foundation.sql
-- Organisations, staff users and roles, plus the RLS helper functions every
-- later policy is written against (CLAUDE.md non-negotiable 7).
--
-- Tenancy rule: every row is reachable from exactly one organisation, and the
-- database refuses to return another organisation's rows whatever the app asks.
-- Keep the role model in step with src/lib/logic/roles.ts.

-- ── Shared trigger: keep updated_at honest ──────────────────────────────────
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── Roles ───────────────────────────────────────────────────────────────────
create type public.staff_role as enum ('admin', 'procurement', 'sales', 'director', 'goods_in');

-- ── Organisations ───────────────────────────────────────────────────────────
-- New organisations are created by an admin script (decisions C1), never by
-- a signed-in user, so there is deliberately no insert/update/delete policy.
create table public.organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 200),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 63),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger organisations_set_updated_at
  before update on public.organisations
  for each row execute function public.set_updated_at();

-- ── Staff users ─────────────────────────────────────────────────────────────
-- One row per internal user, keyed by their Supabase Auth id. A staff user
-- belongs to exactly one organisation. Customer logins (Phase 5) are a
-- separate table, so no customer can ever pass these helpers.
create table public.staff_users (
  id          uuid primary key references auth.users (id) on delete cascade,
  org_id      uuid not null references public.organisations (id) on delete restrict,
  role        public.staff_role not null,
  full_name   text not null check (length(btrim(full_name)) between 1 and 200),
  email       text not null check (position('@' in email) > 1),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index staff_users_org_id_idx on public.staff_users (org_id);
create unique index staff_users_email_lower_idx on public.staff_users (lower(email));

create trigger staff_users_set_updated_at
  before update on public.staff_users
  for each row execute function public.set_updated_at();

-- ── RLS helper functions ────────────────────────────────────────────────────
-- SECURITY DEFINER so policies on staff_users can call them without recursing
-- into staff_users' own policies. search_path is pinned to '' and every name
-- is schema-qualified. Inactive users get NULL/false from every helper, which
-- closes every policy to them.

create function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.org_id
  from public.staff_users s
  where s.id = auth.uid() and s.is_active
$$;

create function public.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select s.role
  from public.staff_users s
  where s.id = auth.uid() and s.is_active
$$;

-- "Elevated" = may read everything in the organisation, including supplier
-- identity and costs: Admin and Director. (Director is still read-only —
-- write policies use is_admin() / can_manage_procurement(), never this.)
create function public.is_elevated()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_staff_role() in ('admin', 'director'), false)
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_staff_role() = 'admin', false)
$$;

create function public.can_manage_procurement()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_staff_role() in ('admin', 'procurement'), false)
$$;

revoke all on function public.current_org_id() from public, anon;
revoke all on function public.current_staff_role() from public, anon;
revoke all on function public.is_elevated() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.can_manage_procurement() from public, anon;
grant execute on function public.current_org_id() to authenticated;
grant execute on function public.current_staff_role() to authenticated;
grant execute on function public.is_elevated() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_manage_procurement() to authenticated;

-- ── Table privileges ────────────────────────────────────────────────────────
-- Belt and braces: anon gets nothing, authenticated gets only what the
-- policies below can ever allow. org_id, id and email can't be changed
-- through the API at all.
revoke all on public.organisations from anon, authenticated;
revoke all on public.staff_users from anon, authenticated;
grant select on public.organisations to authenticated;
grant select on public.staff_users to authenticated;
grant update (role, full_name, is_active) on public.staff_users to authenticated;

-- ── Row-level security ──────────────────────────────────────────────────────
alter table public.organisations enable row level security;
alter table public.staff_users enable row level security;

create policy organisations_select_own
  on public.organisations for select to authenticated
  using (id = public.current_org_id());

create policy staff_users_select_same_org
  on public.staff_users for select to authenticated
  using (org_id = public.current_org_id());

-- Admins manage their own team. An admin can't edit their own row through
-- the API (so they can't lock themselves out or demote the last admin by
-- accident); a second admin, or the admin script, does that.
create policy staff_users_update_by_admin
  on public.staff_users for update to authenticated
  using (org_id = public.current_org_id() and public.is_admin() and id <> auth.uid())
  with check (org_id = public.current_org_id());
