begin;

alter table public.email_outbox
  add column provider text,
  add column provider_message_id text,
  add column provider_status text,
  add column provider_event_at timestamptz,
  add column rendered_message jsonb;
create unique index email_outbox_provider_message_idx on public.email_outbox(provider_message_id) where provider_message_id is not null;

create table public.email_delivery_events (
  event_id text primary key,
  provider_message_id text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);
create table public.email_suppressions (
  recipient_hash text primary key,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.email_delivery_events enable row level security;
alter table public.email_suppressions enable row level security;
revoke all on public.email_delivery_events, public.email_suppressions from anon, authenticated;
grant all on public.email_delivery_events, public.email_suppressions to service_role;

create function public.prepare_email_job(p_id uuid, p_lease uuid, p_message jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb;
begin
  update public.email_outbox set rendered_message = coalesce(rendered_message, p_message)
    where id = p_id and lease_token = p_lease and status = 'processing'
    returning rendered_message into snapshot;
  if not found then raise exception 'Email lease expired' using errcode = '23514'; end if;
  return snapshot;
end;
$$;

create function public.finish_resend_job(p_id uuid, p_lease uuid, p_success boolean,
  p_message_id text, p_retryable boolean, p_error_code text, p_retry_after integer default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_success and coalesce(btrim(p_message_id), '') = '' then
    raise exception 'Provider acceptance requires a message identifier' using errcode = '23514';
  end if;
  update public.email_outbox set provider = 'resend',
    provider_message_id = coalesce(provider_message_id, p_message_id),
    provider_status = case when provider_message_id is not null then provider_status when p_success then 'accepted' else coalesce(p_error_code, 'failed') end,
    status = case when p_success or provider_message_id is not null then 'sent' when not p_retryable or attempts >= 8 then 'dead' else 'pending' end,
    sent_at = case when p_success or provider_message_id is not null then coalesce(sent_at,now()) else null end,
    available_at = now() + make_interval(secs => greatest(30, least(86400, coalesce(p_retry_after, least(3600, (30 * power(2, attempts))::integer))))),
    last_error = case when provider_status in ('bounced','complained','failed','suppressed') and provider_message_id is not null then last_error
      when p_success or provider_message_id is not null then null else left(coalesce(p_error_code, 'delivery_failed'), 64) end,
    locked_until = null, lease_token = null
    where id = p_id and lease_token = p_lease and status = 'processing'
      and (provider_message_id is null or provider_message_id = p_message_id or not p_success);
  return found;
end;
$$;

create function public.record_resend_event(p_event_id text, p_message_id text, p_type text,
  p_occurred_at timestamptz, p_job_id uuid default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare target public.email_outbox%rowtype; address text; state text;
begin
  if p_type not in ('email.sent','email.delivered','email.delivery_delayed','email.bounced','email.complained','email.failed','email.suppressed') then return false; end if;
  select * into target from public.email_outbox
    where provider_message_id = p_message_id or (id = p_job_id and provider_message_id is null)
    order by created_at limit 1 for update;
  if not found then return false; end if;
  insert into public.email_delivery_events(event_id, provider_message_id, event_type, occurred_at)
    values (p_event_id, p_message_id, p_type, p_occurred_at) on conflict (event_id) do nothing;
  if not found then return false; end if;
  state := substring(p_type from 7);
  if target.provider_event_at is null or (p_occurred_at >= target.provider_event_at
      and coalesce(target.provider_status, '') not in ('bounced','complained','suppressed')
      and not (target.provider_status = 'delivered' and state in ('sent','delivery_delayed'))) then
    update public.email_outbox set provider = 'resend', provider_message_id = p_message_id,
      provider_status = state, provider_event_at = p_occurred_at,
      last_error = case when state in ('bounced','complained','failed','suppressed') then 'resend_' || state else last_error end
      where id = target.id;
  end if;
  if state in ('bounced','complained','suppressed') then
    address := coalesce(target.rendered_message->'to'->>0, target.recipient_email);
    if address is not null then
      insert into public.email_suppressions(recipient_hash, reason)
        values (encode(sha256(convert_to(lower(btrim(address)), 'UTF8')), 'hex'), state)
        on conflict (recipient_hash) do nothing;
    end if;
  end if;
  return true;
end;
$$;

revoke execute on function public.prepare_email_job(uuid,uuid,jsonb) from public, anon, authenticated;
revoke execute on function public.finish_resend_job(uuid,uuid,boolean,text,boolean,text,integer) from public, anon, authenticated;
revoke execute on function public.record_resend_event(text,text,text,timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.prepare_email_job(uuid,uuid,jsonb) to service_role;
grant execute on function public.finish_resend_job(uuid,uuid,boolean,text,boolean,text,integer) to service_role;
grant execute on function public.record_resend_event(text,text,text,timestamptz,uuid) to service_role;

notify pgrst, 'reload schema';
commit;