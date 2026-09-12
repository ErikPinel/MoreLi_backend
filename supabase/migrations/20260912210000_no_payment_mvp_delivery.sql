begin;

alter table public.teacher_profiles add column if not exists review_reason text;
alter table public.inquiries add column if not exists contact_sharing_consented_at timestamptz;

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  entity_id uuid not null,
  recipient_id uuid references public.profiles(id) on delete cascade,
  audience text not null check (audience in ('user', 'student', 'teacher', 'admin')),
  recipient_email text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'dead')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  lease_token uuid,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index email_outbox_ready_idx on public.email_outbox(available_at) where status in ('pending', 'processing');
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;
grant all on public.email_outbox to service_role;

create table public.teacher_review_audit (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teacher_profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  previous_status text not null,
  next_status text not null,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.teacher_review_audit enable row level security;
revoke all on public.teacher_review_audit from anon, authenticated;
grant all on public.teacher_review_audit to service_role;

create function public.enqueue_marketplace_email(
  p_kind text, p_entity uuid, p_recipient uuid, p_audience text, p_payload jsonb, p_key text
) returns void language plpgsql security definer set search_path = '' as $$
declare address text;
begin
  if p_recipient is not null then
    select contact_email into address from public.profiles where id = p_recipient;
  end if;
  insert into public.email_outbox(event_key, event_type, entity_id, recipient_id, audience, recipient_email, payload)
  values (p_key || ':' || p_audience, p_kind, p_entity, p_recipient, p_audience, address, p_payload)
  on conflict (event_key) do nothing;
end;
$$;

create function public.queue_account_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare details jsonb;
begin
  if new.contact_email is not null and btrim(new.contact_email) <> '' and
     (tg_op = 'INSERT' or old.contact_email is null or btrim(old.contact_email) = '') then
    details := jsonb_build_object('name', concat_ws(' ', new.first_name, new.last_name), 'role', new.role);
    perform public.enqueue_marketplace_email('account.created', new.id, new.id, 'user', details, 'account:' || new.id);
    perform public.enqueue_marketplace_email('account.created', new.id, null, 'admin', details, 'account:' || new.id);
  end if;
  return new;
end;
$$;
create trigger profiles_queue_email after insert or update of contact_email on public.profiles
for each row execute function public.queue_account_email();

create function public.queue_teacher_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare details jsonb; kind text; event_id text;
begin
  if tg_op = 'INSERT' then
    kind := 'teacher.created';
  elsif new.profile_status is distinct from old.profile_status then
    insert into public.teacher_review_audit(teacher_id, actor_id, previous_status, next_status, reason)
    values (new.id, nullif(current_setting('app.review_actor', true), '')::uuid,
      old.profile_status::text, new.profile_status::text, new.review_reason);
    kind := case when new.profile_status = 'draft' and old.profile_status = 'pending'
      then 'teacher.rejected' else 'teacher.' || new.profile_status::text end;
  else
    return new;
  end if;
  if kind not in ('teacher.created', 'teacher.pending', 'teacher.published', 'teacher.rejected', 'teacher.suspended') then return new; end if;
  select jsonb_build_object('name', concat_ws(' ', first_name, last_name), 'headline', new.headline, 'reason', new.review_reason)
    into details from public.profiles where id = new.user_id;
  event_id := kind || ':' || new.id || ':' || new.updated_at;
  perform public.enqueue_marketplace_email(kind, new.id, new.user_id, 'teacher', details, event_id);
  perform public.enqueue_marketplace_email(kind, new.id, null, 'admin', details, event_id);
  return new;
end;
$$;
create trigger teacher_profiles_queue_email after insert or update on public.teacher_profiles
for each row execute function public.queue_teacher_email();

create function public.validate_inquiry_contact() returns trigger
language plpgsql security definer set search_path = '' as $$
declare student public.profiles%rowtype;
begin
  select * into student from public.profiles where id = new.student_id;
  if student.id is null or btrim(student.first_name) = '' or btrim(student.last_name) = '' or
    coalesce(btrim(student.contact_email), '') = '' or coalesce(btrim(student.phone), '') = '' then
    raise exception 'Complete your name, verified email and phone before requesting a lesson' using errcode = '23514';
  end if;
  new.contact_sharing_consented_at := now();
  return new;
end;
$$;
create trigger inquiries_require_contact before insert on public.inquiries
for each row execute function public.validate_inquiry_contact();

create function public.queue_inquiry_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare details jsonb; teacher_user uuid; kind text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  if new.status not in ('sent', 'accepted', 'declined') then return new; end if;
  select teacher.user_id, jsonb_build_object(
    'studentName', concat_ws(' ', student.first_name, student.last_name),
    'teacherName', concat_ws(' ', profile.first_name, profile.last_name),
    'start', new.requested_start_at, 'end', new.requested_end_at, 'mode', new.lesson_mode,
    'studentEmail', case when new.status = 'accepted' then student.contact_email end,
    'studentPhone', case when new.status = 'accepted' then student.phone end,
    'teacherEmail', case when new.status = 'accepted' then profile.contact_email end,
    'teacherPhone', case when new.status = 'accepted' then profile.phone end
  ) into teacher_user, details
  from public.teacher_profiles teacher
  join public.profiles profile on profile.id = teacher.user_id
  join public.profiles student on student.id = new.student_id
  where teacher.id = new.teacher_id;
  kind := 'inquiry.' || new.status::text;
  perform public.enqueue_marketplace_email(kind, new.id, new.student_id, 'student', details, kind || ':' || new.id);
  perform public.enqueue_marketplace_email(kind, new.id, teacher_user, 'teacher', details, kind || ':' || new.id);
  perform public.enqueue_marketplace_email(kind, new.id, null, 'admin', details, kind || ':' || new.id);
  return new;
end;
$$;
create trigger inquiries_queue_email after insert or update of status on public.inquiries
for each row execute function public.queue_inquiry_email();

create function public.claim_email_jobs(p_limit integer default 10)
returns setof public.email_outbox language plpgsql security definer set search_path = '' as $$
begin
  update public.email_outbox set status = 'dead', last_error = 'Delivery attempts exhausted'
    where attempts >= 8 and (status = 'pending' or (status = 'processing' and locked_until < now()));
  return query
  update public.email_outbox jobs set status = 'processing', attempts = attempts + 1,
    locked_until = now() + interval '5 minutes', lease_token = gen_random_uuid()
  where jobs.id in (
    select pending.id from public.email_outbox pending
    where attempts < 8 and ((status = 'pending' and available_at <= now()) or
      (status = 'processing' and locked_until < now()))
    order by created_at, id for update skip locked limit least(greatest(p_limit, 1), 20)
  ) returning jobs.*;
end;
$$;

create function public.finish_email_job(p_id uuid, p_lease uuid, p_success boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.email_outbox set
    status = case when p_success then 'sent' when attempts >= 8 then 'dead' else 'pending' end,
    sent_at = case when p_success then now() else null end,
    available_at = now() + make_interval(secs => least(3600, (30 * power(2, attempts))::integer)),
    last_error = case when p_success then null else 'Provider rejected or unavailable; inspect delivery dashboard' end,
    locked_until = null, lease_token = null
  where id = p_id and lease_token = p_lease and status = 'processing';
  return found;
end;
$$;

create function public.reject_teacher_review(p_teacher_id uuid, p_actor_id uuid, p_reason text)
returns setof public.teacher_profiles language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = p_actor_id and role = 'admin') then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 5 or length(p_reason) > 2000 then
    raise exception 'An actionable review reason is required' using errcode = '23514';
  end if;
  perform set_config('app.review_actor', p_actor_id::text, true);
  return query update public.teacher_profiles set profile_status = 'draft', verification_status = 'unverified',
    review_reason = btrim(p_reason) where id = p_teacher_id and profile_status = 'pending' returning *;
  if not found then raise exception 'Pending teacher not found' using errcode = 'P0002'; end if;
end;
$$;

create function public.approve_teacher_review_by_admin(p_teacher_id uuid, p_actor_id uuid)
returns setof public.teacher_profiles language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = p_actor_id and role = 'admin') then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  perform set_config('app.review_actor', p_actor_id::text, true);
  return query select * from public.approve_teacher_review(p_teacher_id);
end;
$$;

revoke execute on function public.enqueue_marketplace_email(text, uuid, uuid, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.queue_account_email() from public, anon, authenticated;
revoke execute on function public.queue_teacher_email() from public, anon, authenticated;
revoke execute on function public.validate_inquiry_contact() from public, anon, authenticated;
revoke execute on function public.queue_inquiry_email() from public, anon, authenticated;
revoke execute on function public.claim_email_jobs(integer) from public, anon, authenticated;
revoke execute on function public.finish_email_job(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.reject_teacher_review(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.approve_teacher_review_by_admin(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_email_jobs(integer) to service_role;
grant execute on function public.finish_email_job(uuid, uuid, boolean) to service_role;
grant execute on function public.reject_teacher_review(uuid, uuid, text) to service_role;
grant execute on function public.approve_teacher_review_by_admin(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;