-- Phase 7b, step 2: the branch security rules (docs/03-branches-and-projects.md).
--
-- A sales order is visible if it's assigned to you, or you have "Everyone's
-- orders" and it's in a branch you can see. You can see a branch if you have
-- "See every branch", the business has switched the restriction off, it's
-- your home branch, or an admin granted it. The same rule as
-- src/lib/logic/branches.ts canSeeOrder.
--
-- Everything that hangs off an order already follows the order's own rule
-- (lines, history, shipments, tracking, messages, problems, photos,
-- predictions, internal chases). Purchase orders aren't tied to one order,
-- so they — and their emails, supplier answers and supplier chases — follow
-- the branches of the orders they supply. Goods-in stays organisation-wide.
--
-- With one branch (every business today) nothing changes for anyone: every
-- order and every rep is in the default branch.

-- ── Helpers ─────────────────────────────────────────────────────────────────
create function public.current_user_sees_every_branch()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission('branches.view_all')
      or exists (select 1 from public.organisations o where o.id = public.current_org_id() and not o.restrict_sales_to_branch)
$$;

-- Home branch plus granted branches (for someone who doesn't see every branch).
create function public.current_user_branch_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(b), '{}'::uuid[]) from (
    select s.home_branch_id as b from public.staff_users s
    where s.id = auth.uid() and s.org_id = public.current_org_id() and s.home_branch_id is not null
    union
    select a.branch_id from public.user_branch_access a
    where a.staff_id = auth.uid() and a.org_id = public.current_org_id()
  ) x
$$;

create function public.current_user_can_see_branch(p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_org_id() is not null
     and (public.current_user_sees_every_branch() or p_branch = any (public.current_user_branch_ids()))
$$;

-- Is this order in a branch you can see (or assigned to you)? Branches only —
-- "Everyone's orders" is checked separately where it applies.
create function public.order_branch_visible(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sales_orders o
    where o.id = p_order and o.org_id = public.current_org_id()
      and (o.sales_rep_id = auth.uid() or public.current_user_can_see_branch(o.branch_id))
  )
$$;

-- The whole order rule, for code that needs it outside a policy.
create function public.current_user_can_see_order(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sales_orders o
    where o.id = p_order and o.org_id = public.current_org_id()
      and (o.sales_rep_id = auth.uid()
           or (public.has_permission('orders.view_all') and public.current_user_can_see_branch(o.branch_id)))
  )
$$;

-- A purchase order follows the orders it supplies: visible if any of them
-- is in a branch you can see. One with no lines yet has no branch to hide.
create function public.current_user_can_see_po(p_po uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_user_sees_every_branch()
      or not exists (select 1 from public.purchase_order_lines pl where pl.purchase_order_id = p_po)
      or exists (
        select 1 from public.purchase_order_lines pl
        join public.order_lines l on l.id = pl.order_line_id
        where pl.purchase_order_id = p_po and public.order_branch_visible(l.sales_order_id)
      )
$$;

do $$
declare f text;
begin
  foreach f in array array['current_user_sees_every_branch()', 'current_user_branch_ids()', 'current_user_can_see_branch(uuid)',
                           'order_branch_visible(uuid)', 'current_user_can_see_order(uuid)', 'current_user_can_see_po(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ── Sales orders ────────────────────────────────────────────────────────────
drop policy sales_orders_select on public.sales_orders;
drop policy sales_orders_insert on public.sales_orders;
drop policy sales_orders_update on public.sales_orders;

-- The helpers run once per query (the "select" wrappers), not once per row.
create policy sales_orders_select on public.sales_orders for select to authenticated
  using (org_id = (select public.current_org_id()) and (
    sales_rep_id = (select auth.uid())
    or ((select public.has_permission('orders.view_all'))
        and ((select public.current_user_sees_every_branch()) or branch_id = any ((select public.current_user_branch_ids())::uuid[])))
  ));
-- A new order goes in a branch you can see (the creator's home branch by default).
create policy sales_orders_insert on public.sales_orders for insert to authenticated
  with check (org_id = (select public.current_org_id()) and (select public.has_permission('orders.edit'))
              and public.current_user_can_see_branch(branch_id));
-- Editing needs "Create and edit orders" on top of seeing the order; seeing alone is read-only.
create policy sales_orders_update on public.sales_orders for update to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('orders.edit')) and (
    sales_rep_id = (select auth.uid())
    or ((select public.has_permission('orders.view_all'))
        and ((select public.current_user_sees_every_branch()) or branch_id = any ((select public.current_user_branch_ids())::uuid[])))
  ))
  with check (org_id = (select public.current_org_id()) and (sales_rep_id = (select auth.uid()) or public.current_user_can_see_branch(branch_id)));

-- Moving an order between branches: someone who edits orders and sees every
-- branch (admin and procurement by default), into an active branch. Scheduled
-- jobs and the ERP sync (no signed-in user) take the branch they're given.
grant update (branch_id) on public.sales_orders to authenticated;

create function public.sales_orders_branch_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.branch_id is distinct from old.branch_id and auth.uid() is not null then
    if not (public.has_permission('orders.edit') and public.has_permission('branches.view_all')) then
      raise exception 'Only someone who can edit orders and see every branch can move an order to another branch' using errcode = '42501';
    end if;
    if not exists (select 1 from public.branches b where b.id = new.branch_id and b.org_id = new.org_id and b.is_active) then
      raise exception 'That branch is switched off' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.sales_orders_branch_move() from public, anon, authenticated;

create trigger sales_orders_branch_move
  before update of branch_id on public.sales_orders
  for each row execute function public.sales_orders_branch_move();

-- The move is a logged order event (an internal one: customers never see branches).
create or replace function public.order_events_on_order_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  fields text[] := array[]::text[];
begin
  if new.customer_id is distinct from old.customer_id then fields := array_append(fields, 'customer'); end if;
  if new.customer_reference is distinct from old.customer_reference then fields := array_append(fields, 'customer_reference'); end if;
  if new.sales_rep_id is distinct from old.sales_rep_id then fields := array_append(fields, 'sales_rep'); end if;
  if new.currency is distinct from old.currency then fields := array_append(fields, 'currency'); end if;
  if new.promised_date is distinct from old.promised_date then fields := array_append(fields, 'promised_date'); end if;
  if (new.delivery_name, new.delivery_line1, new.delivery_line2, new.delivery_town, new.delivery_postcode, new.delivery_country)
     is distinct from (old.delivery_name, old.delivery_line1, old.delivery_line2, old.delivery_town, old.delivery_postcode, old.delivery_country)
  then fields := array_append(fields, 'delivery_address'); end if;
  if new.branch_id is distinct from old.branch_id then fields := array_append(fields, 'branch'); end if;
  if cardinality(fields) > 0 then
    insert into public.order_events (sales_order_id, kind, detail, actor_id)
    values (new.id, 'order_updated', jsonb_build_object('fields', to_jsonb(fields)), auth.uid());
  end if;
  return new;
end;
$$;

-- ── Purchase orders and what hangs off them ─────────────────────────────────
drop policy purchase_orders_select on public.purchase_orders;
drop policy purchase_orders_update on public.purchase_orders;
create policy purchase_orders_select on public.purchase_orders for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('supplier.identity.view'))
         and public.current_user_can_see_po(id));
create policy purchase_orders_update on public.purchase_orders for update to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('procurement.manage'))
         and (select public.has_permission('supplier.identity.view')) and public.current_user_can_see_po(id))
  with check (org_id = (select public.current_org_id()));

-- A PO line for another branch's order stays hidden even when the PO itself is visible.
drop policy purchase_order_lines_select on public.purchase_order_lines;
create policy purchase_order_lines_select on public.purchase_order_lines for select to authenticated
  using (exists (select 1 from public.purchase_orders p where p.id = purchase_order_id)
         and ((select public.current_user_sees_every_branch())
              or exists (select 1 from public.order_lines l where l.id = order_line_id and public.order_branch_visible(l.sales_order_id))));

drop policy outbound_emails_select on public.outbound_emails;
create policy outbound_emails_select on public.outbound_emails for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('supplier.identity.view'))
         and (purchase_order_id is null or public.current_user_can_see_po(purchase_order_id)));

drop policy supplier_responses_select on public.supplier_responses;
drop policy supplier_responses_update on public.supplier_responses;
create policy supplier_responses_select on public.supplier_responses for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('supplier.identity.view'))
         and public.current_user_can_see_po(purchase_order_id));
create policy supplier_responses_update on public.supplier_responses for update to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('procurement.manage'))
         and (select public.has_permission('supplier.identity.view')) and public.current_user_can_see_po(purchase_order_id))
  with check (org_id = (select public.current_org_id()));

drop policy chases_select on public.chases;
drop policy chases_update on public.chases;
create policy chases_select on public.chases for select to authenticated
  using (org_id = (select public.current_org_id()) and (
    (kind = 'supplier' and (select public.has_permission('supplier.identity.view')) and public.current_user_can_see_po(purchase_order_id))
    or (kind = 'internal' and exists (select 1 from public.sales_orders o where o.id = sales_order_id))
  ));
create policy chases_update on public.chases for update to authenticated
  using (org_id = (select public.current_org_id()) and (
    (kind = 'supplier' and (select public.has_permission('procurement.manage')) and (select public.has_permission('supplier.identity.view'))
     and public.current_user_can_see_po(purchase_order_id))
    or (kind = 'internal' and ((select public.has_permission('procurement.manage')) or opened_by = (select auth.uid()))
        and exists (select 1 from public.sales_orders o where o.id = sales_order_id))
  ))
  with check (org_id = (select public.current_org_id()));
