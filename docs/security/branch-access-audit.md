# Branches: elevated-access audit (Phase 7b, step 3)

Branch rules live in the database's row-level security (`supabase/migrations/0041_branch_security.sql`),
so anything that **skips** row-level security could show a restricted sales rep
another branch's orders. There are two ways round it, and every one is listed
here with why it's safe. Checked 16 October 2026.

`tests/rls/branches.test.ts` fails if a new function of the first kind appears
without being added below; `tests/static/service-role.test.ts` does the same
for the second kind (`docs/security/service-role-uses.md`).

## 1. Database functions that skip row-level security

`SECURITY DEFINER` functions a signed-in person can call. Most of the app's
database functions run as the signed-in person instead (`create_sales_order`,
`update_sales_order`, `create_purchase_order`, `create_shipment`,
`apply_supplier_answer`, `undo_supplier_answer`, `regenerate_tracking_code`,
`search_order_ids`), so the branch rules apply to them automatically.

| Function | What it returns | Branch-safe because |
|---|---|---|
| `current_org_id()` | The caller's organisation | About the caller only |
| `current_staff_role()` | The caller's role | About the caller only |
| `has_permission()` | Whether the caller has a permission | About the caller only |
| `is_admin()` | Whether the caller is an admin | About the caller only |
| `staff_mfa_status()` | The caller's two-step state | About the caller only |
| `can_manage_person_access()` | Whether the caller may change someone's access | A yes/no about the caller, within their organisation |
| `can_manage_procurement()` | Whether the caller may manage procurement | A yes/no about the caller |
| `connected_providers()` | Names of the organisation's connected integrations | No order data |
| `current_user_sees_every_branch()` | Whether the caller sees every branch | The branch rule itself, about the caller |
| `current_user_branch_ids()` | The caller's home and granted branches | About the caller only |
| `current_user_can_see_branch()` | Yes/no for one branch | The branch rule itself |
| `order_branch_visible()` | Yes/no for one order | The branch rule itself; says nothing about an order the caller can't see |
| `current_user_can_see_order()` | Yes/no for one order | The branch rule itself |
| `current_user_can_see_po()` | Yes/no for one purchase order | The branch rule itself |
| `goods_in_expected()` | Lines due at the warehouse | **Organisation-wide by design**: goods-in isn't branch-scoped (design note). Needs "Check in deliveries"; supplier names only with "Supplier names" |
| `record_goods_receipt()` | Records a delivery | Same as above; needs "Check in deliveries" |
| `rls_auto_enable()` | Nothing | Supabase's own: switches row-level security on for new tables. An event trigger, which can't be called directly |

Taken away from signed-in people in this audit: `default_branch_id()` (it
accepted any organisation's id; only the database's own triggers need it).

## 2. The app's service-role uses

All listed in `docs/security/service-role-uses.md`. For branches:

| Kind | Uses | Branch-safe because |
|---|---|---|
| Acting on one record the staff member has just read with their own client | shipment checks and problems, problem photos and history, customer replies and new tracking codes, the customer preview on an order, account invitations and links | The read goes through the branch rules first; a hidden order isn't found, so nothing happens |
| Admin-only | the organisation's export, data protection, two-step resets | Admins see every branch |
| Scheduled jobs and webhooks | carrier and aggregator tracking, mailbox reading, retention, prediction refreshes, notifications | Never show staff anything; they update records in place |
| Organisation-wide by design | goods-in check-in; refreshing delivery dates after product availability changes | Goods-in isn't branch-scoped; availability is per product, for the whole business |
| Customers | tracking page, portal, messages, accounts | Customers never see branches; scoped by tracking code or their own account |

## 3. Reads that follow the branch rules automatically

Orders, Home, Updates, Chases, Metrics, Problems, Shipments, Purchase orders
and the Review queue all read with the signed-in person's own client, so a
restricted rep's lists, counts and tiles already cover only the orders they
can see. Step 4 adds branch filters and labels on top.

## Known limits (deliberate, recorded in KNOWN-GAPS.md)

- **Emails to sort** (`inbound_messages`) are shown to anyone with "Manage
  suppliers and POs", across every branch. They're supplier emails, worked by
  procurement, who see every branch by default.
- **Audit log** is shown in full to anyone with "Audit log" (admins and
  directors by default, who see every branch).
- **Customer-message alerts** go to the assigned rep, or to procurement when
  there's no rep (C5), whatever the branch.
- **Customers and suppliers** are organisation-wide (design note), so their
  names are visible to everyone who can open those screens.
