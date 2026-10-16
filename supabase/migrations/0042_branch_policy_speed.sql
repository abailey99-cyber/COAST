-- Phase 7b: the purchase-order branch checks from 0041, made cheap for the
-- people who see every branch (admin, procurement, director, sales manager
-- by default). "Sees every branch" is worked out once per query, so their
-- reads no longer look up each PO's orders row by row. Same rules as 0041.

drop policy purchase_orders_select on public.purchase_orders;
drop policy purchase_orders_update on public.purchase_orders;
create policy purchase_orders_select on public.purchase_orders for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('supplier.identity.view'))
         and ((select public.current_user_sees_every_branch()) or public.current_user_can_see_po(id)));
create policy purchase_orders_update on public.purchase_orders for update to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('procurement.manage'))
         and (select public.has_permission('supplier.identity.view'))
         and ((select public.current_user_sees_every_branch()) or public.current_user_can_see_po(id)))
  with check (org_id = (select public.current_org_id()));

drop policy outbound_emails_select on public.outbound_emails;
create policy outbound_emails_select on public.outbound_emails for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('supplier.identity.view'))
         and ((select public.current_user_sees_every_branch()) or purchase_order_id is null or public.current_user_can_see_po(purchase_order_id)));

drop policy supplier_responses_select on public.supplier_responses;
drop policy supplier_responses_update on public.supplier_responses;
create policy supplier_responses_select on public.supplier_responses for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('supplier.identity.view'))
         and ((select public.current_user_sees_every_branch()) or public.current_user_can_see_po(purchase_order_id)));
create policy supplier_responses_update on public.supplier_responses for update to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('procurement.manage'))
         and (select public.has_permission('supplier.identity.view'))
         and ((select public.current_user_sees_every_branch()) or public.current_user_can_see_po(purchase_order_id)))
  with check (org_id = (select public.current_org_id()));

drop policy chases_select on public.chases;
drop policy chases_update on public.chases;
create policy chases_select on public.chases for select to authenticated
  using (org_id = (select public.current_org_id()) and (
    (kind = 'supplier' and (select public.has_permission('supplier.identity.view'))
     and ((select public.current_user_sees_every_branch()) or public.current_user_can_see_po(purchase_order_id)))
    or (kind = 'internal' and exists (select 1 from public.sales_orders o where o.id = sales_order_id))
  ));
create policy chases_update on public.chases for update to authenticated
  using (org_id = (select public.current_org_id()) and (
    (kind = 'supplier' and (select public.has_permission('procurement.manage')) and (select public.has_permission('supplier.identity.view'))
     and ((select public.current_user_sees_every_branch()) or public.current_user_can_see_po(purchase_order_id)))
    or (kind = 'internal' and ((select public.has_permission('procurement.manage')) or opened_by = (select auth.uid()))
        and exists (select 1 from public.sales_orders o where o.id = sales_order_id))
  ))
  with check (org_id = (select public.current_org_id()));
