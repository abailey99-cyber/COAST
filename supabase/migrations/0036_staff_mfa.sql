-- 0036_staff_mfa.sql
-- Readiness plan Task 5B: two-step sign-in (an authenticator app, TOTP) for
-- every staff member, enforced by the database itself.
--
-- For an organisation that requires it (all of them, except demo
-- organisations seeded for automated tests in development), a staff member
-- belongs to no organisation until their session has passed the second step
-- (aal2). current_org_id() is what every staff policy checks, so until then
-- they can read nothing but their own staff record — enough for COAST to ask
-- for the code. Customer accounts and the service role aren't affected.

alter table public.organisations add column require_staff_mfa boolean not null default true;
-- Not changeable by anyone signed in: a company can't switch off its own staff's two-step sign-in.
revoke update (require_staff_mfa) on public.organisations from authenticated;

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.org_id
  from public.staff_users s
  join public.organisations o on o.id = s.org_id
  where s.id = auth.uid() and s.is_active
    and (not o.require_staff_mfa or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
$$;

-- Everyone can read their own staff record (role, organisation), even before the second step.
create policy staff_users_select_own on public.staff_users for select to authenticated using (id = auth.uid());

-- Does the signed-in staff member still need to pass the second step?
create function public.staff_mfa_status()
returns table (required boolean, passed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select o.require_staff_mfa, coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
  from public.staff_users s join public.organisations o on o.id = s.org_id
  where s.id = auth.uid()
$$;
revoke all on function public.staff_mfa_status() from public, anon;
grant execute on function public.staff_mfa_status() to authenticated;

-- The two demo organisations used by automated tests in development and
-- staging sign in with a password only (scripts/seed-demo.ts does the same).
-- They hold no real data. Every real organisation requires two-step sign-in.
update public.organisations set require_staff_mfa = false where slug in ('demo-org-a', 'demo-org-b');
