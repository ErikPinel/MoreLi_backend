begin;

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_key uuid not null,
  category text not null check(category in ('support','bug','billing','report','onboarding')),
  subject text not null check(char_length(subject) between 5 and 160),
  message text not null check(char_length(message) between 10 and 4000),
  teacher_id uuid references public.teacher_profiles(id) on delete set null,
  inquiry_id uuid references public.inquiries(id) on delete set null,
  status text not null default 'open' check(status in ('open','in_progress','resolved','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,request_key)
);
create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  author_role text not null check(author_role in ('user','admin')),
  body text not null check(char_length(body) between 5 and 3000),
  created_at timestamptz not null default now()
);
create index support_ticket_queue on public.support_tickets(status,created_at);
create index support_ticket_owner on public.support_tickets(user_id,created_at);
create index support_message_thread on public.support_messages(ticket_id,created_at);
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
revoke all on public.support_tickets,public.support_messages from anon,authenticated;
grant all on public.support_tickets,public.support_messages to service_role;

create function public.create_support_ticket(p_user_id uuid,p_request_key uuid,p_category text,p_subject text,p_message text,p_teacher_id uuid default null,p_inquiry_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ticket public.support_tickets%rowtype; owner_name text;
begin
  select concat_ws(' ',first_name,last_name) into owner_name from public.profiles where id=p_user_id for update;
  if not found then raise exception 'Profile not found' using errcode='P0002'; end if;
  select * into ticket from public.support_tickets where user_id=p_user_id and request_key=p_request_key;
  if found then return to_jsonb(ticket); end if;
  if (select count(*) from public.support_tickets where user_id=p_user_id and created_at>now()-interval '1 day')>=5 then
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

create function public.reply_support_ticket(p_actor_id uuid,p_ticket_id uuid,p_body text,p_status text default null)
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
  if p_status is not null and p_status not in ('open','in_progress','resolved','rejected') then raise exception 'Invalid support status' using errcode='23514'; end if;
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

create function public.purge_support_email_snapshots() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.email_outbox where entity_id=old.id and event_type in ('support.created','support.updated');
  return old;
end;
$$;
create trigger support_delete_email_snapshots before delete on public.support_tickets
for each row execute function public.purge_support_email_snapshots();

revoke execute on function public.create_support_ticket(uuid,uuid,text,text,text,uuid,uuid) from public,anon,authenticated;
revoke execute on function public.reply_support_ticket(uuid,uuid,text,text) from public,anon,authenticated;
revoke execute on function public.purge_support_email_snapshots() from public,anon,authenticated;
grant execute on function public.create_support_ticket(uuid,uuid,text,text,text,uuid,uuid) to service_role;
grant execute on function public.reply_support_ticket(uuid,uuid,text,text) to service_role;

notify pgrst,'reload schema';
commit;