-- 0023_supplier_answer_grant.sql
-- A supplier confirming through the no-login link runs as the service role,
-- which newer Supabase projects don't grant function access by default.
-- Without this, an answer that matches the PO exactly (and so applies
-- itself) failed with "permission denied"; answers sent for review worked.
grant execute on function public.apply_supplier_answer(jsonb) to service_role;
