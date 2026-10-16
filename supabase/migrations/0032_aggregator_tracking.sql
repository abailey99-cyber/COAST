-- 0032_aggregator_tracking.sql
-- Readiness plan Task 4: tracking through one aggregator, priced per shipment.
--
--   tracking_registrations  each shipment registered once with the aggregator
--   aggregator_events       which aggregator events a shipment has had (webhooks repeat)
--   tracking_usage          per organisation, per month: shipments registered and cost
--   org_plans               an organisation's monthly plan price, for the 5% cap
--                           (set by the founder; billing itself comes later)

create table public.tracking_registrations (
  shipment_id    uuid primary key references public.shipments (id) on delete cascade,
  org_id         uuid not null references public.organisations (id) on delete cascade,
  provider       text not null check (provider ~ '^[a-z0-9_-]{2,30}$'),
  provider_ref   text not null check (length(provider_ref) between 1 and 200),
  tracking_number text not null check (length(tracking_number) between 1 and 60),
  registered_at  timestamptz not null default now(),
  next_check_at  timestamptz,
  last_event_at  timestamptz,
  last_error     text check (length(last_error) <= 300),
  unique (provider, provider_ref)
);

create index tracking_registrations_due_idx on public.tracking_registrations (next_check_at) where next_check_at is not null;
create index tracking_registrations_number_idx on public.tracking_registrations (provider, tracking_number);

create table public.aggregator_events (
  shipment_id  uuid not null references public.shipments (id) on delete cascade,
  event_id     text not null check (length(event_id) between 1 and 300),
  -- The event as COAST read it, so the state can be rebuilt in time order whatever order events arrived in.
  event        jsonb not null,
  received_at  timestamptz not null default now(),
  primary key (shipment_id, event_id)
);

create table public.tracking_usage (
  org_id               uuid not null references public.organisations (id) on delete cascade,
  month                date not null check (extract(day from month) = 1),
  shipments_registered integer not null default 0 check (shipments_registered >= 0),
  cost_minor           bigint not null default 0 check (cost_minor >= 0),
  alerted_level        text check (alerted_level in ('no_plan', 'near', 'over')),
  primary key (org_id, month)
);

create table public.org_plans (
  org_id            uuid primary key references public.organisations (id) on delete cascade,
  plan_price_minor  bigint check (plan_price_minor >= 0),
  updated_at        timestamptz not null default now()
);

-- Add one registration's cost to this month; returns the month's total cost.
create function public.record_tracking_cost(p_org uuid, p_cost bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  m date := date_trunc('month', now() at time zone 'utc')::date;
  total bigint;
begin
  insert into public.tracking_usage (org_id, month, shipments_registered, cost_minor)
  values (p_org, m, 1, greatest(p_cost, 0))
  on conflict (org_id, month) do update
    set shipments_registered = public.tracking_usage.shipments_registered + 1,
        cost_minor = public.tracking_usage.cost_minor + greatest(p_cost, 0)
  returning cost_minor into total;
  return total;
end;
$$;

revoke all on function public.record_tracking_cost(uuid, bigint) from public, anon, authenticated;
grant execute on function public.record_tracking_cost(uuid, bigint) to service_role;

revoke all on public.tracking_registrations, public.aggregator_events, public.tracking_usage, public.org_plans from anon, authenticated;
grant select on public.tracking_registrations, public.tracking_usage to authenticated;
grant all on public.tracking_registrations, public.aggregator_events, public.tracking_usage, public.org_plans to service_role;

alter table public.tracking_registrations enable row level security;
alter table public.aggregator_events enable row level security;
alter table public.tracking_usage enable row level security;
alter table public.org_plans enable row level security;

-- Seen with the shipment (RLS on shipments decides).
create policy tracking_registrations_select on public.tracking_registrations for select to authenticated
  using (org_id = (select public.current_org_id()) and exists (select 1 from public.shipments s where s.id = shipment_id));
-- What tracking costs an organisation: its admins.
create policy tracking_usage_select on public.tracking_usage for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.is_admin()));
-- aggregator_events and org_plans: service role only (no policies).
