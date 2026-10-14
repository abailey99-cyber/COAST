-- 0017_tracking_code_grant.sql
-- COAST's own system account issues new tracking codes after the staff action has checked the person may.
grant execute on function public.regenerate_tracking_code(uuid) to service_role;
