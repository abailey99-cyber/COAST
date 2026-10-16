-- 0033_registration_refs.sql
-- Two organisations can track the same parcel (the same tracking number, so
-- possibly the same aggregator reference): the reference identifies the
-- parcel, the registration row identifies whose shipment it is. Each
-- organisation's shipment still only ever gets updates for itself.
alter table public.tracking_registrations drop constraint tracking_registrations_provider_provider_ref_key;
create index tracking_registrations_ref_idx on public.tracking_registrations (provider, provider_ref);
