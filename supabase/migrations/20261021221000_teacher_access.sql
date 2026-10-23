begin;

create table public.teacher_access (
  teacher_id uuid primary key references public.teacher_profiles(id) on delete cascade,
  free_contact_used boolean not null default false,
  paid_until timestamptz,
  updated_at timestamptz not null default now()
);
create table public.teacher_contact_grants (
  teacher_id uuid not null references public.teacher_profiles(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (teacher_id, student_id)
);
create table public.teacher_access_payments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teacher_profiles(id) on delete cascade,
  amount_ils integer not null default 60 check (amount_ils = 60),
  reference text not null check (char_length(reference) between 3 and 160),
  terms_accepted_at timestamptz not null default now(),
  terms_version text not null default 'manual-access-2026-10-21',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (char_length(review_note) <= 1000),
  period_start_at timestamptz,
  period_end_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index teacher_access_one_pending_payment on public.teacher_access_payments(teacher_id) where status='pending';
create unique index teacher_access_payment_reference on public.teacher_access_payments(teacher_id,lower(reference));
create index teacher_access_payment_queue on public.teacher_access_payments(status, created_at);
alter table public.teacher_access enable row level security;
alter table public.teacher_contact_grants enable row level security;
alter table public.teacher_access_payments enable row level security;
revoke all on public.teacher_access, public.teacher_contact_grants, public.teacher_access_payments from anon, authenticated;
grant all on public.teacher_access, public.teacher_contact_grants, public.teacher_access_payments to service_role;

insert into public.teacher_access(teacher_id, free_contact_used)
select teacher.id, exists(select 1 from public.inquiries where teacher_id=teacher.id and status='accepted')
from public.teacher_profiles teacher;
insert into public.teacher_contact_grants(teacher_id, student_id, granted_at)
select teacher_id, student_id, min(coalesce(responded_at,created_at)) from public.inquiries
where status='accepted' group by teacher_id,student_id;

create function public.guard_teacher_contact_access() returns trigger
language plpgsql security definer set search_path = '' as $$
declare access_row public.teacher_access%rowtype;
begin
  if new.status <> 'accepted' then return new; end if;
  if tg_op='UPDATE' and old.status='accepted' then return new; end if;
  perform id from public.teacher_profiles where id=new.teacher_id for update;
  insert into public.teacher_access(teacher_id) values(new.teacher_id) on conflict(teacher_id) do nothing;
  select * into access_row from public.teacher_access where teacher_id=new.teacher_id for update;
  if exists(select 1 from public.teacher_contact_grants where teacher_id=new.teacher_id and student_id=new.student_id) then return new; end if;
  if access_row.paid_until > now() then null;
  elsif not access_row.free_contact_used then
    update public.teacher_access set free_contact_used=true, updated_at=now() where teacher_id=new.teacher_id;
  else
    raise exception 'TEACHER_ACCESS_REQUIRED' using errcode='P0001';
  end if;
  insert into public.teacher_contact_grants(teacher_id,student_id) values(new.teacher_id,new.student_id) on conflict do nothing;
  return new;
end;
$$;
create trigger inquiries_teacher_access before insert or update of status on public.inquiries
for each row execute function public.guard_teacher_contact_access();

create function public.teacher_access_summary(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare teacher uuid; details jsonb;
begin
  select id into teacher from public.teacher_profiles where user_id=p_user_id;
  if not found then raise exception 'Teacher not found' using errcode='P0002'; end if;
  select jsonb_build_object('freeContactUsed',coalesce(access.free_contact_used,false),
    'paidUntil',access.paid_until,'active',coalesce(access.paid_until>now(),false),
    'canAcceptNewContact',not coalesce(access.free_contact_used,false) or coalesce(access.paid_until>now(),false),
    'priceIls',60,'period','month','paymentMethod','Bit',
    'payments',coalesce((select jsonb_agg(record) from (select id,status,amount_ils,created_at,reviewed_at,review_note,period_start_at,period_end_at
      from public.teacher_access_payments where teacher_id=teacher order by created_at desc limit 12) record),'[]'::jsonb))
    into details from (select teacher as id) owned left join public.teacher_access access on access.teacher_id=owned.id;
  return details;
end;
$$;

create function public.claim_teacher_access_payment(p_user_id uuid,p_reference text,p_terms boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare teacher uuid; payment public.teacher_access_payments%rowtype; owner_name text;
begin
  if p_terms is distinct from true or char_length(btrim(coalesce(p_reference,''))) not between 3 and 160 then
    raise exception 'Payment reference and explicit terms agreement required' using errcode='23514';
  end if;
  select id into teacher from public.teacher_profiles where user_id=p_user_id for update;
  if not found then raise exception 'Teacher not found' using errcode='P0002'; end if;
  select * into payment from public.teacher_access_payments where teacher_id=teacher and lower(reference)=lower(btrim(p_reference));
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

create function public.review_teacher_access_payment(p_actor_id uuid,p_payment_id uuid,p_approve boolean,p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare payment public.teacher_access_payments%rowtype; teacher_user uuid; next_start timestamptz; next_end timestamptz; decision text; owner_name text;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin') then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_approve is null or char_length(coalesce(p_note,''))>1000 or (not p_approve and char_length(btrim(coalesce(p_note,'')))<5) then
    raise exception 'A clear review decision is required' using errcode='23514';
  end if;
  select * into payment from public.teacher_access_payments where id=p_payment_id;
  if not found then raise exception 'Payment not found' using errcode='P0002'; end if;
  select user_id into teacher_user from public.teacher_profiles where id=payment.teacher_id for update;
  select * into payment from public.teacher_access_payments where id=p_payment_id for update;
  decision:=case when p_approve then 'approved' else 'rejected' end;
  if payment.status=decision then return to_jsonb(payment); end if;
  if payment.status<>'pending' then raise exception 'Payment already reviewed' using errcode='23514'; end if;
  if p_approve then
    insert into public.teacher_access(teacher_id) values(payment.teacher_id) on conflict do nothing;
    select greatest(now(),coalesce(paid_until,now())) into next_start from public.teacher_access where teacher_id=payment.teacher_id for update;
    next_end:=next_start+interval '1 month';
    update public.teacher_access set paid_until=next_end,updated_at=now() where teacher_id=payment.teacher_id;
  end if;
  update public.teacher_access_payments set status=decision,reviewed_by=p_actor_id,reviewed_at=now(),review_note=nullif(btrim(p_note),''),
    period_start_at=next_start,period_end_at=next_end where id=p_payment_id returning * into payment;
  select concat_ws(' ',first_name,last_name) into owner_name from public.profiles where id=teacher_user;
  insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
    values(teacher_user,'billing_updated',case when p_approve then 'הגישה החודשית הופעלה' else 'דיווח התשלום לא אושר' end,
      case when p_approve then 'אפשר לקבל פניות חדשות בתקופת הגישה שאושרה.' else coalesce(nullif(btrim(p_note),''),'יש לפנות לתמיכה לבירור.') end,'payment',payment.id);
  perform public.enqueue_marketplace_email('billing.'||decision,payment.id,teacher_user,'teacher',
    jsonb_build_object('teacherName',owner_name,'until',next_end,'reason',p_note,'amount','60'),'billing.'||decision||':'||payment.id);
  perform public.enqueue_marketplace_email('billing.'||decision,payment.id,null,'admin',
    jsonb_build_object('teacherName',owner_name,'until',next_end,'reason',p_note,'amount','60'),'billing.'||decision||':'||payment.id);
  return to_jsonb(payment);
end;
$$;

revoke execute on function public.guard_teacher_contact_access() from public,anon,authenticated;
revoke execute on function public.teacher_access_summary(uuid) from public,anon,authenticated;
revoke execute on function public.claim_teacher_access_payment(uuid,text,boolean) from public,anon,authenticated;
revoke execute on function public.review_teacher_access_payment(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.teacher_access_summary(uuid) to service_role;
grant execute on function public.claim_teacher_access_payment(uuid,text,boolean) to service_role;
grant execute on function public.review_teacher_access_payment(uuid,uuid,boolean,text) to service_role;

notify pgrst,'reload schema';
commit;