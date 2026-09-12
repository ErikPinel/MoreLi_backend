begin;

create or replace function public.enqueue_marketplace_email(
  p_kind text, p_entity uuid, p_recipient uuid, p_audience text, p_payload jsonb, p_key text
) returns void language plpgsql security definer set search_path = '' as $$
declare address text;
begin
  if p_recipient is not null then
    select contact_email into address from public.profiles where id = p_recipient;
  end if;
  if p_kind in ('inquiry.sent', 'inquiry.accepted', 'inquiry.declined') and p_payload->>'mode' in ('in_person', 'online') then
    p_payload := p_payload || jsonb_build_object('modeLabel', case p_payload->>'mode' when 'in_person' then 'פרונטלי' else 'אונליין' end);
  end if;
  insert into public.email_outbox(event_key, event_type, entity_id, recipient_id, audience, recipient_email, payload)
  values (p_key || ':' || p_audience, p_kind, p_entity, p_recipient, p_audience, address, p_payload)
  on conflict (event_key) do nothing;
end;
$$;

update public.email_outbox
set payload = payload || jsonb_build_object('modeLabel', case payload->>'mode' when 'in_person' then 'פרונטלי' else 'אונליין' end)
where event_type in ('inquiry.sent', 'inquiry.accepted', 'inquiry.declined')
  and payload->>'mode' in ('in_person', 'online');

revoke execute on function public.enqueue_marketplace_email(text, uuid, uuid, text, jsonb, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;