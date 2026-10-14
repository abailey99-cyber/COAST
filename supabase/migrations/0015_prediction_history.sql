-- 0015_prediction_history.sql
-- An order's history records a prediction change only when it means
-- something: the at-risk flag or the kind of date changes, or a date from
-- a person, the supplier or the carrier moves. Estimates counted from
-- "today" drift by a day every day; recording each drift would bury the
-- history (the prediction itself is still updated).

create or replace function public.order_events_on_prediction()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.predicted_from is null and new.at_risk is not true then return new; end if;
  elsif new.at_risk is not distinct from old.at_risk
    and new.source is not distinct from old.source
    and new.confidence is not distinct from old.confidence
    and (
      (new.predicted_from is not distinct from old.predicted_from and new.predicted_to is not distinct from old.predicted_to)
      or new.source in ('lead_time', 'stock', 'in_transit', 'unknown')
    ) then
    return new;
  end if;
  insert into public.order_events (sales_order_id, kind, detail, actor_id)
  values (
    new.sales_order_id, 'prediction_changed',
    jsonb_build_object(
      'from', new.predicted_from, 'to', new.predicted_to, 'source', new.source, 'confidence', new.confidence, 'at_risk', new.at_risk,
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
