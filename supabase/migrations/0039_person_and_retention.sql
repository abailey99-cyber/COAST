-- 0039_person_and_retention.sql
-- Readiness plan Task 6: find, export and remove one person's details, and
-- retention of customer contact details and message text on closed orders.
-- Everything is limited to one organisation (p_org, which the app takes from
-- the signed-in admin) and keeps the order history: what identifies the
-- person is cleared, the orders, lines, POs and shipments stay.
-- Service role only.

-- ── One person, by email (and optionally the name they gave) ────────────────
create function public.find_person(p_org uuid, p_email text, p_name text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'order_update_emails', coalesce((select jsonb_agg(jsonb_build_object('order', o.so_number, 'email', p.email, 'level', p.level, 'updated_at', p.updated_at))
        from public.customer_notification_prefs p join public.sales_orders o on o.id = p.sales_order_id
        where o.org_id = p_org and lower(p.email) = lower(p_email)), '[]'::jsonb),
    'emails_sent_to_them', coalesce((select jsonb_agg(jsonb_build_object('order', o.so_number, 'to', n.to_address, 'subject', n.subject, 'sent_at', n.created_at))
        from public.customer_notifications n join public.sales_orders o on o.id = n.sales_order_id
        where n.org_id = p_org and lower(n.to_address) = lower(p_email)), '[]'::jsonb),
    'emails_from_them', coalesce((select jsonb_agg(jsonb_build_object('from', m.from_address, 'subject', m.subject, 'received_at', m.received_at, 'text', m.body))
        from public.inbound_messages m where m.org_id = p_org and (lower(m.from_address) like '%' || lower(p_email) || '%')), '[]'::jsonb),
    'emails_to_them_as_supplier', coalesce((select jsonb_agg(jsonb_build_object('to', e.to_address, 'subject', e.subject, 'sent_at', e.created_at))
        from public.outbound_emails e where e.org_id = p_org and lower(e.to_address) = lower(p_email)), '[]'::jsonb),
    'supplier_contact', coalesce((select jsonb_agg(jsonb_build_object('supplier', s.name, 'email', s.email, 'other_addresses', s.known_senders))
        from public.suppliers s where s.org_id = p_org and (lower(s.email) = lower(p_email) or lower(p_email) = any (s.known_senders))), '[]'::jsonb),
    'customer_account', coalesce((select jsonb_agg(jsonb_build_object('name', a.full_name, 'email', a.email, 'linked_since', l.vouched_at))
        from public.customer_accounts a join public.customer_account_links l on l.user_id = a.user_id
        where l.org_id = p_org and lower(a.email) = lower(p_email)), '[]'::jsonb),
    'messages_they_wrote', coalesce((select jsonb_agg(jsonb_build_object('order', o.so_number, 'name', m.customer_name, 'text', m.body, 'sent_at', m.created_at))
        from public.order_messages m join public.sales_orders o on o.id = m.sales_order_id
        where m.org_id = p_org and m.author_kind = 'customer' and p_name is not null and length(btrim(p_name)) >= 3 and lower(m.customer_name) = lower(btrim(p_name))), '[]'::jsonb),
    'problems_they_reported', coalesce((select jsonb_agg(jsonb_build_object('order', o.so_number, 'name', x.reporter_name, 'text', x.description, 'reported_at', x.created_at))
        from public.delivery_exceptions x join public.sales_orders o on o.id = x.sales_order_id
        where x.org_id = p_org and x.raised_via = 'customer' and p_name is not null and length(btrim(p_name)) >= 3 and lower(x.reporter_name) = lower(btrim(p_name))), '[]'::jsonb)
  );
$$;

create function public.forget_person(p_org uuid, p_email text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  removed constant text := '[removed at the person''s request]';
  n_prefs int; n_notes int; n_in int; n_out int; n_sup int; n_links int; n_msgs int := 0; n_probs int := 0;
begin
  update public.customer_notification_prefs p set email = null
  from public.sales_orders o where o.id = p.sales_order_id and o.org_id = p_org and lower(p.email) = lower(p_email);
  get diagnostics n_prefs = row_count;
  update public.customer_notifications set to_address = null, subject = removed, body_text = removed, body_html = removed
  where org_id = p_org and lower(to_address) = lower(p_email);
  get diagnostics n_notes = row_count;
  update public.inbound_messages set from_address = removed, envelope_sender = null, body = removed
  where org_id = p_org and lower(from_address) like '%' || lower(p_email) || '%';
  get diagnostics n_in = row_count;
  update public.outbound_emails set to_address = removed, body_text = removed, body_html = removed
  where org_id = p_org and lower(to_address) = lower(p_email);
  get diagnostics n_out = row_count;
  update public.suppliers set email = case when lower(email) = lower(p_email) then null else email end,
    known_senders = array_remove(known_senders, lower(p_email))
  where org_id = p_org and (lower(email) = lower(p_email) or lower(p_email) = any (known_senders));
  get diagnostics n_sup = row_count;
  -- Their COAST account is theirs, across businesses: this organisation stops following it and forgets its link.
  delete from public.customer_account_orders ao using public.customer_accounts a, public.sales_orders o
  where ao.user_id = a.user_id and ao.sales_order_id = o.id and o.org_id = p_org and lower(a.email) = lower(p_email);
  delete from public.customer_account_links l using public.customer_accounts a
  where l.user_id = a.user_id and l.org_id = p_org and lower(a.email) = lower(p_email);
  get diagnostics n_links = row_count;
  if p_name is not null and length(btrim(p_name)) >= 3 then
    update public.order_messages set customer_name = null, body = removed, redacted_at = now()
    where org_id = p_org and author_kind = 'customer' and lower(customer_name) = lower(btrim(p_name));
    get diagnostics n_msgs = row_count;
    update public.delivery_exceptions set reporter_name = null, description = removed
    where org_id = p_org and raised_via = 'customer' and lower(reporter_name) = lower(btrim(p_name));
    get diagnostics n_probs = row_count;
  end if;
  return jsonb_build_object('order_update_emails', n_prefs, 'emails_sent_to_them', n_notes, 'emails_from_them', n_in,
    'emails_to_them_as_supplier', n_out, 'supplier_contact', n_sup, 'customer_account', n_links, 'messages_they_wrote', n_msgs, 'problems_they_reported', n_probs);
end;
$$;

-- ── Retention ───────────────────────────────────────────────────────────────
-- An order is closed when every line is delivered or cancelled; it's old once
-- nothing has happened on it for p_months.
create function public.retention_targets(p_org uuid, p_months integer)
returns table (sales_order_id uuid) language sql stable security definer set search_path = '' as $$
  select o.id from public.sales_orders o
  where o.org_id = p_org
    and not exists (select 1 from public.order_lines l where l.sales_order_id = o.id and l.stage not in ('delivered', 'cancelled'))
    and exists (select 1 from public.order_lines l where l.sales_order_id = o.id)
    and coalesce((select max(e.created_at) from public.order_events e where e.sales_order_id = o.id), o.created_at) < now() - make_interval(months => p_months);
$$;

create function public.retention_report(p_org uuid, p_months integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  with t as (select sales_order_id from public.retention_targets(p_org, p_months))
  select jsonb_build_object(
    'orders', (select count(*) from t),
    'update_emails', (select count(*) from public.customer_notification_prefs p where p.sales_order_id in (select * from t) and p.email is not null),
    'sent_emails', (select count(*) from public.customer_notifications n where n.sales_order_id in (select * from t) and n.to_address is not null),
    'messages', (select count(*) from public.order_messages m where m.sales_order_id in (select * from t) and m.redacted_at is null),
    'problem_reports', (select count(*) from public.delivery_exceptions x where x.sales_order_id in (select * from t) and x.raised_via = 'customer' and (x.description is not null or x.reporter_name is not null))
  );
$$;

create function public.apply_retention(p_org uuid, p_months integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cleared constant text := '[cleared under the retention policy]';
  report jsonb := public.retention_report(p_org, p_months);
begin
  create temporary table retention_t on commit drop as select sales_order_id from public.retention_targets(p_org, p_months);
  update public.customer_notification_prefs set email = null where sales_order_id in (select sales_order_id from retention_t) and email is not null;
  update public.customer_notifications set to_address = null, subject = cleared, body_text = cleared, body_html = cleared
  where sales_order_id in (select sales_order_id from retention_t) and to_address is not null;
  update public.order_messages set customer_name = null, body = cleared, redacted_at = now()
  where sales_order_id in (select sales_order_id from retention_t) and redacted_at is null;
  update public.delivery_exceptions set reporter_name = null, description = cleared
  where sales_order_id in (select sales_order_id from retention_t) and raised_via = 'customer' and (description is not null or reporter_name is not null);
  return report;
end;
$$;

revoke all on function public.find_person(uuid, text, text) from public, anon, authenticated;
revoke all on function public.forget_person(uuid, text, text) from public, anon, authenticated;
revoke all on function public.retention_targets(uuid, integer) from public, anon, authenticated;
revoke all on function public.retention_report(uuid, integer) from public, anon, authenticated;
revoke all on function public.apply_retention(uuid, integer) from public, anon, authenticated;
grant execute on function public.find_person(uuid, text, text), public.forget_person(uuid, text, text),
  public.retention_targets(uuid, integer), public.retention_report(uuid, integer), public.apply_retention(uuid, integer) to service_role;
