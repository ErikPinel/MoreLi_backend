begin;

alter table public.teacher_access_payments
  add column reconsideration_of uuid unique references public.teacher_access_payments(id),
  add column support_ticket_id uuid references public.support_tickets(id) on delete set null;

drop index public.teacher_access_payment_reference;
create unique index teacher_access_payment_reference on public.teacher_access_payments(teacher_id,lower(reference))
  where reconsideration_of is null;

create function public.reopen_teacher_access_payment(p_actor_id uuid,p_payment_id uuid,p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare original public.teacher_access_payments%rowtype; payment public.teacher_access_payments%rowtype;
  ticket public.support_tickets%rowtype; teacher_user uuid;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin') then
    raise exception 'Administrator required' using errcode='42501';
  end if;
  select * into ticket from public.support_tickets where id=p_ticket_id;
  if not found then raise exception 'Support ticket not found' using errcode='P0002'; end if;
  select * into original from public.teacher_access_payments where id=p_payment_id;
  if not found then raise exception 'Payment not found' using errcode='P0002'; end if;
  select user_id into teacher_user from public.teacher_profiles where id=original.teacher_id for update;
  if ticket.category<>'billing' or ticket.user_id<>teacher_user then
    raise exception 'A billing ticket from the payment owner is required' using errcode='23514';
  end if;
  select * into original from public.teacher_access_payments where id=p_payment_id for update;
  select * into payment from public.teacher_access_payments where reconsideration_of=p_payment_id;
  if found then return to_jsonb(payment); end if;
  if original.status<>'rejected' then
    raise exception 'Only a rejected payment can be reconsidered' using errcode='23514';
  end if;
  if exists(select 1 from public.teacher_access_payments where teacher_id=original.teacher_id and status='pending') then
    raise exception 'Review the existing pending payment first' using errcode='23505';
  end if;
  insert into public.teacher_access_payments(teacher_id,reference,terms_accepted_at,terms_version,reconsideration_of,support_ticket_id)
    values(original.teacher_id,original.reference,original.terms_accepted_at,original.terms_version,original.id,ticket.id)
    returning * into payment;
  insert into public.support_messages(ticket_id,author_id,author_role,body)
    values(ticket.id,p_actor_id,'admin','דיווח התשלום נפתח לבדיקה מחדש. ההחלטה הקודמת נשמרה בהיסטוריה. פתיחת הבדיקה אינה אישור תשלום ואינה מפעילה גישה.');
  update public.support_tickets set status='in_progress',updated_at=now() where id=ticket.id;
  insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
    values(teacher_user,'billing_updated','דיווח התשלום נפתח לבדיקה מחדש','הפנייה נבדקת שוב. הגישה תופעל רק לאחר אישור התשלום.','payment',payment.id);
  return to_jsonb(payment);
end;
$$;

create or replace function public.claim_teacher_access_payment(p_user_id uuid,p_reference text,p_terms boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare teacher uuid; payment public.teacher_access_payments%rowtype; owner_name text;
begin
  if p_terms is distinct from true or char_length(btrim(coalesce(p_reference,''))) not between 3 and 160 then
    raise exception 'Payment reference and explicit terms agreement required' using errcode='23514';
  end if;
  select id into teacher from public.teacher_profiles where user_id=p_user_id for update;
  if not found then raise exception 'Teacher not found' using errcode='P0002'; end if;
  select * into payment from public.teacher_access_payments
    where teacher_id=teacher and lower(reference)=lower(btrim(p_reference))
    order by created_at desc,id limit 1;
  if found then return to_jsonb(payment); end if;
  insert into public.teacher_access_payments(teacher_id,reference) values(teacher,btrim(p_reference))
    on conflict(teacher_id) where status='pending' do nothing returning * into payment;
  if not found then
    select * into payment from public.teacher_access_payments where teacher_id=teacher and status='pending';
    return to_jsonb(payment);
  end if;
  select concat_ws(' ',first_name,last_name) into owner_name from public.profiles where id=p_user_id;
  insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
    values(p_user_id,'billing_updated','דיווח התשלום התקבל','הגישה תופעל רק לאחר בדיקת התשלום ואישור מנהל.','payment',payment.id);
  perform public.enqueue_marketplace_email('billing.requested',payment.id,null,'admin',
    jsonb_build_object('teacherName',owner_name,'reference',payment.reference,'amount','60'),'billing.requested:'||payment.id);
  perform public.enqueue_marketplace_email('billing.requested',payment.id,p_user_id,'teacher',
    jsonb_build_object('teacherName',owner_name,'amount','60'),'billing.requested:'||payment.id);
  return to_jsonb(payment);
end;
$$;

revoke execute on function public.reopen_teacher_access_payment(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reopen_teacher_access_payment(uuid,uuid,uuid) to service_role;

create or replace function public.teacher_access_summary(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare teacher uuid; details jsonb;
begin
  select id into teacher from public.teacher_profiles where user_id=p_user_id;
  if not found then raise exception 'Teacher not found' using errcode='P0002'; end if;
  select jsonb_build_object('freeContactUsed',coalesce(access.free_contact_used,false),
    'paidUntil',access.paid_until,'active',coalesce(access.paid_until>now(),false),
    'canAcceptNewContact',not coalesce(access.free_contact_used,false) or coalesce(access.paid_until>now(),false),
    'priceIls',60,'period','month','paymentMethod','Bit',
    'payments',coalesce((select jsonb_agg(record) from (select id,status,amount_ils,reference,created_at,reviewed_at,review_note,period_start_at,period_end_at,reconsideration_of,support_ticket_id
      from public.teacher_access_payments where teacher_id=teacher order by created_at desc,id limit 12) record),'[]'::jsonb))
    into details from (select teacher as id) owned left join public.teacher_access access on access.teacher_id=owned.id;
  return details;
end;
$$;

notify pgrst,'reload schema';
commit;
