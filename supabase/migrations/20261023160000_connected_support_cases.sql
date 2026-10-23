begin;

alter table public.support_tickets
  add column workflow text check(workflow in ('onboarding','payment')),
  add column payment_id uuid references public.teacher_access_payments(id) on delete set null,
  -- Keep the target ID when its author deletes the review; do not retain deleted content.
  add column review_id uuid,
  add constraint support_ticket_workflow_category check(
    workflow is null or (workflow='onboarding' and category='onboarding') or (workflow='payment' and category='billing'));
alter table public.support_tickets drop constraint support_tickets_status_check;
alter table public.support_tickets add constraint support_tickets_status_check
  check(status in ('open','in_progress','waiting_customer','resolved','rejected'));
alter table public.support_messages drop constraint support_messages_author_role_check;
alter table public.support_messages add constraint support_messages_author_role_check check(author_role in ('user','admin','system'));
create unique index support_onboarding_case on public.support_tickets(teacher_id) where workflow='onboarding';
create index support_payment_case on public.support_tickets(payment_id) where payment_id is not null;

create function public.record_case_decision(p_ticket_id uuid,p_actor_id uuid,p_status text,p_message text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.support_tickets set status=p_status,updated_at=now() where id=p_ticket_id;
  insert into public.support_messages(ticket_id,author_id,author_role,body)
    values(p_ticket_id,p_actor_id,'system',p_message);
end;
$$;

create function public.ensure_onboarding_case(p_teacher_id uuid,p_notify boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare teacher public.teacher_profiles%rowtype; ticket_id uuid;
begin
  select * into teacher from public.teacher_profiles where id=p_teacher_id for update;
  if not found then raise exception 'Teacher not found' using errcode='P0002'; end if;
  select id into ticket_id from public.support_tickets where workflow='onboarding' and teacher_id=teacher.id;
  if found then return ticket_id; end if;
  insert into public.support_tickets(user_id,request_key,category,workflow,teacher_id,subject,message)
    values(teacher.user_id,gen_random_uuid(),'onboarding','onboarding',teacher.id,'בדיקת פרופיל המורה',
      'הפרופיל נשלח לבדיקה. כאן אפשר לעקוב אחר ההחלטה, לקבל בקשות לתיקון ולהשיב לצוות. הפרופיל יפורסם רק לאחר אישור מנהל.')
    returning id into ticket_id;
  if p_notify then
    insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
      values(teacher.user_id,'support_updated','נפתחה פנייה לבדיקת פרופיל המורה','אפשר לעקוב אחר הבדיקה ולהשיב לצוות בפנייה.','support',ticket_id);
  end if;
  return ticket_id;
end;
$$;

create function public.ensure_payment_case(p_payment_id uuid,p_notify boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare payment public.teacher_access_payments%rowtype; teacher_user uuid; ticket public.support_tickets%rowtype; ticket_id uuid;
begin
  select * into payment from public.teacher_access_payments where id=p_payment_id;
  if not found then raise exception 'Payment not found' using errcode='P0002'; end if;
  select user_id into teacher_user from public.teacher_profiles where id=payment.teacher_id;
  if payment.reconsideration_of is not null and exists(
    select 1 from public.teacher_access_payments original where original.id=payment.reconsideration_of
      and original.support_ticket_id is not null and original.support_ticket_id is distinct from payment.support_ticket_id) then
    raise exception 'Reconsider the payment in its linked billing case' using errcode='23514';
  end if;
  if payment.support_ticket_id is not null then
    select * into ticket from public.support_tickets where id=payment.support_ticket_id for update;
    if not found or ticket.user_id<>teacher_user or ticket.category<>'billing' then
      raise exception 'A billing case from the payment owner is required' using errcode='23514';
    end if;
    if ticket.workflow='payment' and ticket.payment_id is not null and
       ticket.payment_id<>payment.id and ticket.payment_id is distinct from payment.reconsideration_of then
      raise exception 'The case belongs to another payment' using errcode='23514';
    end if;
    update public.support_tickets set workflow='payment',payment_id=payment.id,teacher_id=payment.teacher_id,
      status=case when payment.status='pending' then 'in_progress' else status end,updated_at=now() where id=ticket.id;
    return ticket.id;
  end if;
  insert into public.support_tickets(user_id,request_key,category,workflow,teacher_id,payment_id,subject,message)
    values(teacher_user,gen_random_uuid(),'billing','payment',payment.teacher_id,payment.id,'בדיקת דיווח תשלום Bit',
      'נשלח דיווח על העברת Bit בסך 60 ש"ח. אסמכתא: '||payment.reference||'. הדיווח ממתין לבדיקה ואינו מפעיל גישה אוטומטית.')
    returning id into ticket_id;
  update public.teacher_access_payments set support_ticket_id=ticket_id where id=payment.id;
  if p_notify then
    insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
      values(teacher_user,'support_updated','נפתחה פנייה לבדיקת התשלום','פרטי הבדיקה, ההחלטה והשיחה עם הצוות נשמרים בפנייה.','support',ticket_id);
  end if;
  return ticket_id;
end;
$$;

create function public.sync_onboarding_case() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ticket_id uuid; actor uuid;
begin
  if tg_op='UPDATE' and new.profile_status is not distinct from old.profile_status then return new; end if;
  actor:=nullif(current_setting('app.review_actor',true),'')::uuid;
  if new.profile_status='pending' then
    ticket_id:=public.ensure_onboarding_case(new.id);
    if tg_op='UPDATE' then
      perform public.record_case_decision(ticket_id,null,'open','הפרופיל נשלח לבדיקה. הצוות יבדוק את הפרטים ויעדכן בפנייה הזו.');
    end if;
  elsif tg_op='UPDATE' and old.profile_status='pending' and new.profile_status in ('published','draft') then
    ticket_id:=public.ensure_onboarding_case(new.id);
    perform public.record_case_decision(ticket_id,actor,
      case when new.profile_status='published' then 'resolved' else 'waiting_customer' end,
      case when new.profile_status='published' then 'פרופיל המורה אושר ופורסם. הפנייה נסגרה אוטומטית לאחר האישור.'
        else 'הפרופיל הוחזר לתיקון: '||coalesce(nullif(new.review_reason,''),'יש לבדוק את הפרטים בעמוד פרופיל המורה.')||
          ' לאחר שמירה ושליחה מחדש הפנייה תחזור לבדיקה. אין צורך לפתוח פנייה חדשה.' end);
  end if;
  return new;
end;
$$;
create trigger teacher_profiles_connected_case after insert or update of profile_status on public.teacher_profiles
  for each row execute function public.sync_onboarding_case();

create function public.sync_payment_case() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ticket_id uuid;
begin
  if tg_op='UPDATE' and new.status is not distinct from old.status then return new; end if;
  ticket_id:=public.ensure_payment_case(new.id);
  if new.status in ('approved','rejected') then
    perform public.record_case_decision(ticket_id,new.reviewed_by,
      case when new.status='approved' then 'resolved' else 'waiting_customer' end,
      case when new.status='approved' then 'התשלום אושר ונוספה תקופת גישה חודשית. הפנייה נסגרה אוטומטית לאחר האישור.'
        else 'דיווח התשלום לא אושר. הסיבה: '||coalesce(nullif(new.review_note,''),'יש להשלים פרטים לבדיקת התשלום.')||
          ' אפשר להשיב כאן עם פרטים נוספים. אין לשלם שוב רק בגלל דחיית הדיווח.' end);
  end if;
  return new;
end;
$$;
create trigger teacher_access_payment_connected_case after insert or update of status on public.teacher_access_payments
  for each row execute function public.sync_payment_case();

create or replace function public.reply_support_ticket(p_actor_id uuid,p_ticket_id uuid,p_body text,p_status text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ticket public.support_tickets%rowtype; actor_admin boolean; reply public.support_messages%rowtype;
begin
  select role='admin' into actor_admin from public.profiles where id=p_actor_id;
  select * into ticket from public.support_tickets where id=p_ticket_id and (user_id=p_actor_id or coalesce(actor_admin,false)) for update;
  if not found then raise exception 'Support ticket not found' using errcode='P0002'; end if;
  if char_length(btrim(coalesce(p_body,''))) not between 5 and 3000 then raise exception 'A clear response is required' using errcode='23514'; end if;
  if not coalesce(actor_admin,false) and (p_status is not null or ticket.status='rejected') then
    raise exception 'Administrator required for this action' using errcode='42501';
  end if;
  if p_status is not null and p_status not in ('open','in_progress','waiting_customer','resolved','rejected') then raise exception 'Invalid support status' using errcode='23514'; end if;
  if not coalesce(actor_admin,false) and (select count(*) from public.support_messages where ticket_id=p_ticket_id and author_id=p_actor_id and created_at>now()-interval '1 day')>=10 then
    raise exception 'Daily reply limit reached' using errcode='23514';
  end if;
  insert into public.support_messages(ticket_id,author_id,author_role,body)
    values(ticket.id,p_actor_id,case when actor_admin then 'admin' else 'user' end,btrim(p_body)) returning * into reply;
  update public.support_tickets set status=case when actor_admin then coalesce(p_status,'in_progress') else 'open' end,updated_at=now() where id=p_ticket_id;
  if actor_admin then
    insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
      values(ticket.user_id,'support_updated','התקבל מענה לפנייה שלכם',ticket.subject,'support',ticket.id);
    perform public.enqueue_marketplace_email('support.updated',ticket.id,ticket.user_id,'user',
      jsonb_build_object('subject',ticket.subject,'message',reply.body,'status',coalesce(p_status,'in_progress')),'support.reply:'||reply.id);
  else
    perform public.enqueue_marketplace_email('support.updated',ticket.id,null,'admin',
      jsonb_build_object('subject',ticket.subject,'message',reply.body,'status','open'),'support.reply:'||reply.id);
  end if;
  return to_jsonb(reply);
end;
$$;

create or replace function public.create_support_ticket(p_user_id uuid,p_request_key uuid,p_category text,p_subject text,p_message text,
  p_teacher_id uuid default null,p_inquiry_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ticket public.support_tickets%rowtype; owner_name text;
begin
  select concat_ws(' ',first_name,last_name) into owner_name from public.profiles where id=p_user_id for update;
  if not found then raise exception 'Profile not found' using errcode='P0002'; end if;
  select * into ticket from public.support_tickets where user_id=p_user_id and request_key=p_request_key;
  if found then return to_jsonb(ticket); end if;
  if (select count(*) from public.support_tickets where user_id=p_user_id and workflow is null and created_at>now()-interval '1 day')>=5 then
    raise exception 'Support request limit reached; contact support directly for urgent help' using errcode='23514';
  end if;
  if p_inquiry_id is not null and not exists(select 1 from public.inquiries inquiry join public.teacher_profiles teacher on teacher.id=inquiry.teacher_id
    where inquiry.id=p_inquiry_id and (inquiry.student_id=p_user_id or teacher.user_id=p_user_id)) then
    raise exception 'Related inquiry not found' using errcode='P0002';
  end if;
  insert into public.support_tickets(user_id,request_key,category,subject,message,teacher_id,inquiry_id)
    values(p_user_id,p_request_key,p_category,btrim(p_subject),btrim(p_message),p_teacher_id,p_inquiry_id) returning * into ticket;
  insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
    values(p_user_id,'support_updated','הפנייה לתמיכה התקבלה','אפשר לעקוב ולהוסיף פרטים בעמוד התמיכה.','support',ticket.id);
  perform public.enqueue_marketplace_email('support.created',ticket.id,null,'admin',
    jsonb_build_object('name',owner_name,'category',p_category,'subject',ticket.subject,'message',ticket.message),'support.created:'||ticket.id);
  perform public.enqueue_marketplace_email('support.created',ticket.id,p_user_id,'user',
    jsonb_build_object('subject',ticket.subject,'category',p_category),'support.created:'||ticket.id);
  return to_jsonb(ticket);
end;
$$;

create function public.create_context_support_ticket(p_user_id uuid,p_request_key uuid,p_category text,p_subject text,p_message text,
  p_teacher_id uuid default null,p_inquiry_id uuid default null,p_review_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ticket jsonb; review_teacher uuid;
begin
  if p_review_id is not null then
    select review.teacher_id into review_teacher from public.reviews review
      join public.teacher_profiles teacher on teacher.id=review.teacher_id
      where review.id=p_review_id and (review.status='published' or review.student_id=p_user_id or teacher.user_id=p_user_id);
    if not found or p_category<>'report' or (p_teacher_id is not null and p_teacher_id<>review_teacher) then
      raise exception 'Reported review not found' using errcode='P0002';
    end if;
  end if;
  ticket:=public.create_support_ticket(p_user_id,p_request_key,p_category,p_subject,p_message,coalesce(review_teacher,p_teacher_id),p_inquiry_id);
  if ticket->>'category'<>p_category or (ticket->>'teacher_id')::uuid is distinct from coalesce(review_teacher,p_teacher_id) or
    (ticket->>'inquiry_id')::uuid is distinct from p_inquiry_id then
    raise exception 'The request key belongs to another case context' using errcode='23514';
  end if;
  if p_review_id is not null then
    if (ticket->>'review_id') is not null and (ticket->>'review_id')::uuid<>p_review_id then
      raise exception 'The request key belongs to another report' using errcode='23514';
    end if;
    update public.support_tickets set review_id=p_review_id where id=(ticket->>'id')::uuid returning to_jsonb(support_tickets.*) into ticket;
  end if;
  return ticket;
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
    where teacher_id=teacher and lower(reference)=lower(btrim(p_reference)) order by created_at desc,id limit 1;
  if found then return to_jsonb(payment); end if;
  insert into public.teacher_access_payments(teacher_id,reference) values(teacher,btrim(p_reference))
    on conflict(teacher_id) where status='pending' do nothing returning * into payment;
  if not found then
    select * into payment from public.teacher_access_payments where teacher_id=teacher and status='pending';
    return to_jsonb(payment);
  end if;
  -- AFTER INSERT links the new report to its case; return the persisted link too.
  select * into payment from public.teacher_access_payments saved where saved.id=payment.id;
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

revoke execute on function public.record_case_decision(uuid,uuid,text,text) from public,anon,authenticated;
revoke execute on function public.ensure_onboarding_case(uuid,boolean) from public,anon,authenticated;
revoke execute on function public.ensure_payment_case(uuid,boolean) from public,anon,authenticated;
revoke execute on function public.sync_onboarding_case() from public,anon,authenticated;
revoke execute on function public.sync_payment_case() from public,anon,authenticated;
revoke execute on function public.create_context_support_ticket(uuid,uuid,text,text,text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_context_support_ticket(uuid,uuid,text,text,text,uuid,uuid,uuid) to service_role;

-- Link existing pending work without sending retrospective emails or changing domain decisions.
do $$
declare item record; ticket_id uuid; current_status text;
begin
  for item in select id from public.teacher_profiles where profile_status='pending' loop
    perform public.ensure_onboarding_case(item.id,false);
  end loop;
  for item in select id from public.teacher_access_payments where status='pending' loop
    perform public.ensure_payment_case(item.id,false);
  end loop;
  for item in select distinct on(support_ticket_id) * from public.teacher_access_payments
    where support_ticket_id is not null and status in ('approved','rejected')
    order by support_ticket_id,created_at desc,id loop
    if not exists(
      select 1 from public.teacher_access_payments where support_ticket_id=item.support_ticket_id and status='pending') then
      ticket_id:=public.ensure_payment_case(item.id,false);
      select status into current_status from public.support_tickets where id=ticket_id;
      if current_status in ('open','in_progress','waiting_customer') then
        perform public.record_case_decision(ticket_id,item.reviewed_by,
          case when item.status='approved' then 'resolved' else 'waiting_customer' end,
          case when item.status='approved' then 'התשלום אושר. הפנייה נסגרה בהתאם להחלטה השמורה.'
            else 'דיווח התשלום לא אושר. הסיבה שנשמרה: '||coalesce(nullif(item.review_note,''),'יש להשלים פרטים לבדיקת התשלום.') end);
      end if;
    end if;
  end loop;
end;
$$;

notify pgrst,'reload schema';
commit;
