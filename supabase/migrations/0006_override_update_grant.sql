-- 0006_override_update_grant.sql
-- Changing an existing individual exception updates `granted` and records
-- who changed it. 0005 only granted `granted`.

grant update (granted, set_by, set_at) on public.staff_permission_overrides to authenticated;

-- set_by must always be the person making the change.
drop policy staff_permission_overrides_update on public.staff_permission_overrides;

create policy staff_permission_overrides_update
  on public.staff_permission_overrides for update to authenticated
  using (public.can_manage_person_access(user_id, permission))
  with check (public.can_manage_person_access(user_id, permission) and set_by = auth.uid());
