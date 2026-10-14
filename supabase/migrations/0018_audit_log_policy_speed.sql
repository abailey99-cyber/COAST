-- 0018_audit_log_policy_speed.sql
-- The audit log grows quickly. Its policy called the permission helpers once
-- per row; wrapped in (select …) they run once per query instead (Supabase's
-- recommended form). Same rule, much faster.

drop policy audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using (org_id = (select public.current_org_id()) and ((select public.is_admin()) or (select public.has_permission('audit.view'))));

create index if not exists audit_log_org_table_idx on public.audit_log (org_id, table_name, id desc);
