-- 0014_predictions.sql
-- Phase 4: delivery-date prediction, the at-risk flag and lead times.
--
--   order_predictions          the latest prediction per order, written by COAST (kept apart so recalculating never floods the audit log)
--   sales_orders.predicted_override_*   a delivery date set by hand — sticky (non-negotiable 3)
--   order_lines.lead_time_override_*    a line's lead time set by hand — sticky
--   product_availability       "available within N days" per product code, pasted or uploaded (decision C2)
--   prediction_settings        per organisation: turnaround, delivery and estimate-width days
--
-- The rules live in src/lib/logic/prediction.ts; the database only stores
-- the result and records changes in the order's history.

-- ── A date set by hand, per order ───────────────────────────────────────────
alter table public.sales_orders
  add column predicted_override_from date,
  add column predicted_override_to date,
  add column predicted_override_note text check (length(predicted_override_note) <= 300),
  add column predicted_override_by uuid references auth.users (id) on delete set null,
  add column predicted_override_at timestamptz,
  add constraint sales_orders_override_range check (predicted_override_to is null or (predicted_override_from is not null and predicted_override_to >= predicted_override_from));

grant update (predicted_override_from, predicted_override_to, predicted_override_note, predicted_override_by, predicted_override_at) on public.sales_orders to authenticated;

-- ── A lead time set by hand, per line ───────────────────────────────────────
alter table public.order_lines
  add column lead_time_override_days integer check (lead_time_override_days between 0 and 365),
  add column lead_time_override_by uuid references auth.users (id) on delete set null,
  add column lead_time_override_at timestamptz;

grant update (lead_time_override_days, lead_time_override_by, lead_time_override_at) on public.order_lines to authenticated;

-- ── Predictions ─────────────────────────────────────────────────────────────
create table public.order_predictions (
  sales_order_id  uuid primary key references public.sales_orders (id) on delete cascade,
  predicted_from  date,
  predicted_to    date,
  source          text not null check (source in ('delivered', 'manual', 'carrier', 'supplier_confirmed', 'lead_time', 'stock', 'in_transit', 'unknown')),
  confidence      text not null check (confidence in ('confirmed', 'estimate', 'unknown')),
  at_risk         boolean,
  reason          text not null check (length(reason) <= 500),
  -- Per line: [{lineId, lineNo, done, from, to, source, note}] — never a supplier name.
  lines           jsonb not null default '[]'::jsonb,
  computed_at     timestamptz not null default now(),
  check (predicted_to is null or (predicted_from is not null and predicted_to >= predicted_from))
);

create index order_predictions_computed_idx on public.order_predictions (computed_at);
create index order_predictions_at_risk_idx on public.order_predictions (at_risk) where at_risk;

-- A moved date or a change in risk goes into the order's history (and, from Phase 5, drives customer notifications).
alter table public.order_events drop constraint order_events_kind_check;
alter table public.order_events add constraint order_events_kind_check check (kind in (
  'order_created', 'line_stage_changed', 'po_raised', 'po_status_changed', 'order_updated', 'line_added', 'line_updated',
  'po_emailed', 'supplier_responded', 'chase_opened', 'chase_chased', 'chase_resolved',
  'shipment_added', 'shipment_status_changed', 'prediction_changed'
));

create function public.order_events_on_prediction()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.predicted_from is null and new.at_risk is not true then return new; end if;
  elsif new.predicted_from is not distinct from old.predicted_from
    and new.predicted_to is not distinct from old.predicted_to
    and new.at_risk is not distinct from old.at_risk then
    return new;
  end if;
  insert into public.order_events (sales_order_id, kind, detail, actor_id)
  values (
    new.sales_order_id, 'prediction_changed',
    jsonb_build_object(
      'from', new.predicted_from, 'to', new.predicted_to, 'source', new.source, 'at_risk', new.at_risk,
      'was_from', case when tg_op = 'UPDATE' then old.predicted_from end,
      'was_to', case when tg_op = 'UPDATE' then old.predicted_to end,
      'was_at_risk', case when tg_op = 'UPDATE' then old.at_risk end
    ),
    auth.uid()
  );
  return new;
end;
$$;

revoke all on function public.order_events_on_prediction() from public, anon, authenticated;
create trigger order_predictions_event after insert or update on public.order_predictions for each row execute function public.order_events_on_prediction();

-- ── Availability by product code ────────────────────────────────────────────
create table public.product_availability (
  org_id             uuid not null references public.organisations (id) on delete cascade,
  sku                text not null check (sku ~ '^[A-Z0-9][A-Z0-9._/-]{0,99}$'),
  available_in_days  integer not null check (available_in_days between 0 and 365),
  source             text not null check (source in ('manual', 'csv')),
  updated_by         uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at         timestamptz not null default now(),
  primary key (org_id, sku)
);

create trigger product_availability_set_updated_at before update on public.product_availability for each row execute function public.set_updated_at();

-- ── Prediction settings per organisation ────────────────────────────────────
create table public.prediction_settings (
  org_id         uuid primary key references public.organisations (id) on delete cascade,
  handling_days  integer not null default 1 check (handling_days between 0 and 30),
  delivery_days  integer not null default 2 check (delivery_days between 0 and 30),
  spread_days    integer not null default 2 check (spread_days between 0 and 30),
  updated_by     uuid references auth.users (id) on delete set null,
  updated_at     timestamptz not null default now()
);

create trigger prediction_settings_set_updated_at before update on public.prediction_settings for each row execute function public.set_updated_at();

create function public.seed_prediction_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.prediction_settings (org_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.seed_prediction_settings() from public, anon, authenticated;
create trigger organisations_seed_prediction_settings after insert on public.organisations for each row execute function public.seed_prediction_settings();
insert into public.prediction_settings (org_id) select id from public.organisations on conflict do nothing;

-- ── Audit ───────────────────────────────────────────────────────────────────
create trigger audit after insert or update or delete on public.product_availability for each row execute function public.audit_row_change('org_id', 'sku');
create trigger audit after insert or update or delete on public.prediction_settings for each row execute function public.audit_row_change('org_id');

-- ── Privileges ──────────────────────────────────────────────────────────────
revoke all on public.order_predictions, public.product_availability, public.prediction_settings from anon, authenticated;

grant select on public.order_predictions to authenticated;
grant select, insert, delete on public.product_availability to authenticated;
grant update (available_in_days, source, updated_by) on public.product_availability to authenticated;
grant select on public.prediction_settings to authenticated;
grant update (handling_days, delivery_days, spread_days, updated_by) on public.prediction_settings to authenticated;

grant all on public.order_predictions, public.product_availability, public.prediction_settings to service_role;

-- ── Row-level security ──────────────────────────────────────────────────────
alter table public.order_predictions enable row level security;
alter table public.product_availability enable row level security;
alter table public.prediction_settings enable row level security;

-- Predictions: through their order. Only COAST (the service role) writes them.
create policy order_predictions_select on public.order_predictions for select to authenticated
  using (exists (select 1 from public.sales_orders o where o.id = sales_order_id));

create policy product_availability_select on public.product_availability for select to authenticated
  using (org_id = public.current_org_id());
create policy product_availability_insert on public.product_availability for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_permission('procurement.manage'));
create policy product_availability_update on public.product_availability for update to authenticated
  using (org_id = public.current_org_id() and public.has_permission('procurement.manage'))
  with check (org_id = public.current_org_id());
create policy product_availability_delete on public.product_availability for delete to authenticated
  using (org_id = public.current_org_id() and public.has_permission('procurement.manage'));

create policy prediction_settings_select on public.prediction_settings for select to authenticated
  using (org_id = public.current_org_id());
create policy prediction_settings_update on public.prediction_settings for update to authenticated
  using (org_id = public.current_org_id() and public.has_permission('settings.edit'))
  with check (org_id = public.current_org_id());
