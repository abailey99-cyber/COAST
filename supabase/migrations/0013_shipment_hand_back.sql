-- 0013_shipment_hand_back.sql
-- Handing a shipment's status back to the carrier (after a person set it by
-- hand) starts checking it again straight away.

create or replace function public.shipments_sync_poll_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.carrier is distinct from old.carrier or new.tracking_number is distinct from old.tracking_number then
    update public.shipment_poll_state
    set carrier = new.carrier, failures = 0, last_error = null,
        next_poll_at = case when new.tracking_number is not null and new.status <> 'delivered' then now() end
    where shipment_id = new.id;
  elsif new.status_source = 'carrier' and old.status_source = 'manual' then
    update public.shipment_poll_state set next_poll_at = case when new.tracking_number is not null then now() end, failures = 0
    where shipment_id = new.id;
  elsif new.status = 'delivered' and old.status <> 'delivered' and new.status_source = 'manual' then
    update public.shipment_poll_state set next_poll_at = null where shipment_id = new.id;
  elsif old.status = 'delivered' and new.status <> 'delivered' then
    update public.shipment_poll_state set next_poll_at = now() where shipment_id = new.id and new.tracking_number is not null;
  end if;
  return new;
end;
$$;

revoke all on function public.shipments_sync_poll_state() from public, anon, authenticated;
