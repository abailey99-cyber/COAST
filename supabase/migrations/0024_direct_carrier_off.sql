-- 0024_direct_carrier_off.sql
-- Readiness plan Task 1: "show a direct shipment's carrier and tracking link
-- to the customer" is off for every organisation. A carrier's label and its
-- own tracking page can show where a parcel came from, and that's outside
-- COAST's control. New organisations already start with it off (0016); this
-- turns it off for existing ones. An admin can still switch it on.
update public.customer_page_settings set show_direct_carrier = false where show_direct_carrier;
alter table public.customer_page_settings alter column show_direct_carrier set default false;
