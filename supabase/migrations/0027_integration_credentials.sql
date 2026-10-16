-- 0027_integration_credentials.sql
-- Readiness plan Task 2: every organisation holds its own integration
-- credentials, encrypted at rest (AES-256-GCM in src/lib/secrets/crypto.ts;
-- the master key is only in the hosting settings, never here). Plus a
-- security-event log, and carrier call counting per organisation (each
-- organisation now brings its own carrier account and allowance).

-- ── Credentials ─────────────────────────────────────────────────────────────
create table public.integration_credentials (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organisations (id) on delete cascade,
  provider       text not null check (provider in ('microsoft365', 'netsuite', 'dhl', 'fedex', 'ups', 'royal_mail')),
  kind           text not null check (kind in ('api_key', 'oauth_client', 'netsuite_m2m', 'microsoft365_tenant')),
  -- Non-secret settings (a NetSuite account id, a Microsoft tenant id and mailbox).
  config         jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object' and length(config::text) <= 4000),
  -- The encrypted secret. Never readable by signed-in users (column grants below).
  ciphertext     text check (ciphertext ~ '^v[0-9]{1,4}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]*$'),
  key_version    integer check (key_version between 1 and 9999),
  -- The last few characters, so an admin can tell which key is in use.
  hint           text check (length(hint) <= 8),
  status         text not null default 'active' check (status in ('active', 'error')),
  last_error     text check (length(last_error) <= 300),
  created_by     uuid references auth.users (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  rotated_at     timestamptz,
  last_used_at   timestamptz,
  unique (org_id, provider),
  check ((ciphertext is null) = (key_version is null))
);

-- ── Security events ─────────────────────────────────────────────────────────
create table public.security_events (
  id          bigint generated always as identity primary key,
  org_id      uuid references public.organisations (id) on delete cascade,
  kind        text not null check (kind ~ '^[a-z_]{3,40}$'),
  actor_id    uuid references auth.users (id) on delete set null,
  -- Never a secret: what happened, to what.
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index security_events_org_idx on public.security_events (org_id, created_at desc);

-- Every create, rotate and delete is recorded by the database itself.
create function public.integration_credentials_log()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.security_events (org_id, kind, actor_id, detail)
    values (new.org_id, 'credential_created', auth.uid(), jsonb_build_object('provider', new.provider, 'kind', new.kind, 'key_version', new.key_version));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.security_events (org_id, kind, actor_id, detail)
    values (old.org_id, 'credential_deleted', auth.uid(), jsonb_build_object('provider', old.provider, 'kind', old.kind));
    return old;
  end if;
  if new.ciphertext is distinct from old.ciphertext or new.config is distinct from old.config then
    insert into public.security_events (org_id, kind, actor_id, detail)
    values (new.org_id,
            case when auth.uid() is null and new.config is not distinct from old.config then 'credential_reencrypted' else 'credential_rotated' end,
            auth.uid(),
            jsonb_build_object('provider', new.provider, 'kind', new.kind, 'from_key_version', old.key_version, 'key_version', new.key_version));
  end if;
  return new;
end;
$$;

revoke all on function public.integration_credentials_log() from public, anon, authenticated;
create trigger integration_credentials_log after insert or update or delete on public.integration_credentials
  for each row execute function public.integration_credentials_log();
-- Deliberately no audit_row_change trigger: it would copy the ciphertext into
-- audit_log. security_events records the same facts without it.

-- ── Privileges ──────────────────────────────────────────────────────────────
revoke all on public.integration_credentials, public.security_events from anon, authenticated;
grant select (id, org_id, provider, kind, config, key_version, hint, status, last_error, created_by, created_at, rotated_at, last_used_at)
  on public.integration_credentials to authenticated;
grant insert (org_id, provider, kind, config, ciphertext, key_version, hint) on public.integration_credentials to authenticated;
grant update (config, ciphertext, key_version, hint, status, last_error, rotated_at) on public.integration_credentials to authenticated;
grant delete on public.integration_credentials to authenticated;
grant select on public.security_events to authenticated;
grant all on public.integration_credentials, public.security_events to service_role;

alter table public.integration_credentials enable row level security;
alter table public.security_events enable row level security;

-- Anyone who can open Settings sees what's connected (never the secret); only admins change it.
create policy integration_credentials_select on public.integration_credentials for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('section.settings')));
create policy integration_credentials_insert on public.integration_credentials for insert to authenticated
  with check (org_id = (select public.current_org_id()) and (select public.is_admin()));
create policy integration_credentials_update on public.integration_credentials for update to authenticated
  using (org_id = (select public.current_org_id()) and (select public.is_admin()))
  with check (org_id = (select public.current_org_id()));
create policy integration_credentials_delete on public.integration_credentials for delete to authenticated
  using (org_id = (select public.current_org_id()) and (select public.is_admin()));

create policy security_events_select on public.security_events for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.is_admin()));

-- ── Carrier calls per organisation ──────────────────────────────────────────
-- Each organisation now uses its own carrier account, so its own allowance.
-- The old platform-wide counters are only counters: start afresh.
delete from public.carrier_activity;
alter table public.carrier_activity drop constraint carrier_activity_pkey;
alter table public.carrier_activity add column org_id uuid not null references public.organisations (id) on delete cascade;
alter table public.carrier_activity add primary key (org_id, carrier);

drop policy carrier_activity_select on public.carrier_activity;
create policy carrier_activity_select on public.carrier_activity for select to authenticated
  using (org_id = (select public.current_org_id()));

drop function public.reserve_carrier_calls(text, integer, integer);
drop function public.record_carrier_outcome(text, text);

-- Reserve up to p_wanted calls against an organisation's daily limit for a carrier (UTC day); returns how many were granted.
create function public.reserve_carrier_calls(p_org uuid, p_carrier text, p_limit integer, p_wanted integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'utc')::date;
  used integer;
  granted integer;
begin
  insert into public.carrier_activity (org_id, carrier, usage_day) values (p_org, p_carrier, today) on conflict (org_id, carrier) do nothing;
  select case when usage_day = today then calls_today else 0 end into used
  from public.carrier_activity where org_id = p_org and carrier = p_carrier for update;
  granted := greatest(0, least(greatest(p_wanted, 0), case when p_limit is null then p_wanted else p_limit - used end));
  update public.carrier_activity set usage_day = today, calls_today = used + granted where org_id = p_org and carrier = p_carrier;
  return granted;
end;
$$;

-- Record how a call went: p_error null = success.
create function public.record_carrier_outcome(p_org uuid, p_carrier text, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.carrier_activity (org_id, carrier) values (p_org, p_carrier) on conflict (org_id, carrier) do nothing;
  if p_error is null then
    update public.carrier_activity set last_success_at = now(), consecutive_failures = 0 where org_id = p_org and carrier = p_carrier;
  else
    update public.carrier_activity
    set last_error_at = now(), last_error_kind = p_error, consecutive_failures = consecutive_failures + 1
    where org_id = p_org and carrier = p_carrier;
  end if;
end;
$$;

revoke all on function public.reserve_carrier_calls(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.record_carrier_outcome(uuid, text, text) from public, anon, authenticated;
grant execute on function public.reserve_carrier_calls(uuid, text, integer, integer) to service_role;
grant execute on function public.record_carrier_outcome(uuid, text, text) to service_role;
