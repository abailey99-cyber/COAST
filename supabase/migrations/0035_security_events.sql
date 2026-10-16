-- 0035_security_events.sql
-- Readiness plan Task 5B: security-event logging and sign-in lockout.
--
--   rate_limit_count()     how many hits a bucket has in its current window,
--                          without adding one (for account lockout)
--   role and access changes, staff switched on or off, and supplier links
--   revoked are written to security_events by the database itself.

create function public.rate_limit_count(p_bucket text, p_window_seconds integer)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((select hits from public.rate_limit_hits
                   where bucket = p_bucket
                     and window_start = to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds)), 0);
$$;
revoke all on function public.rate_limit_count(text, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_count(text, integer) to service_role;

-- Someone's role changes, or they're switched off or on.
create function public.staff_users_security_log()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role is distinct from old.role then
    insert into public.security_events (org_id, kind, actor_id, detail)
    values (new.org_id, 'role_changed', auth.uid(), jsonb_build_object('user_id', new.id, 'from', old.role, 'to', new.role));
  end if;
  if new.is_active is distinct from old.is_active then
    insert into public.security_events (org_id, kind, actor_id, detail)
    values (new.org_id, case when new.is_active then 'staff_reactivated' else 'staff_deactivated' end, auth.uid(), jsonb_build_object('user_id', new.id));
  end if;
  return new;
end;
$$;
revoke all on function public.staff_users_security_log() from public, anon, authenticated;
create trigger staff_users_security_log after update on public.staff_users for each row execute function public.staff_users_security_log();

-- A person's own access changed (allowed or blocked something on top of their role).
create function public.staff_overrides_security_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r record := coalesce(new, old);
  org uuid;
begin
  select org_id into org from public.staff_users where id = r.user_id;
  insert into public.security_events (org_id, kind, actor_id, detail)
  values (org, 'access_changed', auth.uid(),
          jsonb_build_object('user_id', r.user_id, 'permission', r.permission, 'granted', case when tg_op = 'DELETE' then null else new.granted end, 'change', lower(tg_op)));
  return r;
end;
$$;
revoke all on function public.staff_overrides_security_log() from public, anon, authenticated;
create trigger staff_overrides_security_log after insert or update or delete on public.staff_permission_overrides for each row execute function public.staff_overrides_security_log();

-- A role's permissions changed for the whole organisation.
create function public.role_permissions_security_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r record := coalesce(new, old);
begin
  insert into public.security_events (org_id, kind, actor_id, detail)
  values (r.org_id, case when tg_op = 'DELETE' then 'role_permission_removed' else 'role_permission_added' end, auth.uid(),
          jsonb_build_object('role', r.role, 'permission', r.permission));
  return r;
end;
$$;
revoke all on function public.role_permissions_security_log() from public, anon, authenticated;
create trigger role_permissions_security_log after insert or delete on public.role_permissions for each row execute function public.role_permissions_security_log();

-- A supplier's confirmation link revoked.
create function public.po_links_security_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  org uuid;
begin
  if new.revoked_at is not null and old.revoked_at is null then
    select org_id into org from public.purchase_orders where id = new.purchase_order_id;
    insert into public.security_events (org_id, kind, actor_id, detail)
    values (org, 'link_revoked', auth.uid(), jsonb_build_object('purchase_order_id', new.purchase_order_id, 'link_id', new.id));
  end if;
  return new;
end;
$$;
revoke all on function public.po_links_security_log() from public, anon, authenticated;
create trigger po_links_security_log after update on public.po_links for each row execute function public.po_links_security_log();
