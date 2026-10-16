-- Phase 7b, step 3 (elevated-access audit): default_branch_id() takes any
-- organisation's id, so signed-in people shouldn't call it. Only the
-- database's own triggers need it, and they run with the owner's rights.
revoke execute on function public.default_branch_id(uuid) from authenticated;
