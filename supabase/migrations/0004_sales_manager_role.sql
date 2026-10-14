-- 0004_sales_manager_role.sql
-- Adds the Sales manager role (product-owner decision E7). On its own
-- because Postgres can't use a new enum value in the migration that adds it;
-- 0005 sets up its permissions.

alter type public.staff_role add value if not exists 'sales_manager' after 'procurement';
