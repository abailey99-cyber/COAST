-- 0037_own_staff_row_active.sql
-- 0036 let staff read their own record before two-step sign-in. A
-- deactivated person must see nothing at all, not even that.
drop policy staff_users_select_own on public.staff_users;
create policy staff_users_select_own on public.staff_users for select to authenticated using (id = auth.uid() and is_active);
