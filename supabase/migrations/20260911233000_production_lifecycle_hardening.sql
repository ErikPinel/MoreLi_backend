begin;

create type public.notification_type as enum (
  'inquiry_received',
  'inquiry_accepted',
  'inquiry_declined',
  'inquiry_expired',
  'review_received',
  'teacher_verified',
  'teacher_suspended'
);

alter table public.teacher_profiles
  add column claimed_at timestamptz,
  add column terms_accepted_at timestamptz;

alter table public.reviews
  drop constraint reviews_student_id_teacher_id_key;

create unique index inquiries_request_teacher_key
  on public.inquiries (request_id, teacher_id)
  where request_id is not null;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type public.notification_type not null,
  title varchar(200) not null,
  body text not null,
  entity_type varchar(50) not null,
  entity_id uuid not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc, id desc);
create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;
revoke all on table public.notifications from anon, authenticated;
grant all on table public.notifications to service_role;

drop function public.create_teacher_draft(uuid, text);

create function public.create_teacher_draft(
  p_user_id uuid,
  p_slug text,
  p_terms_accepted boolean
)
returns setof public.teacher_profiles
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_terms_accepted is not true then
    raise exception 'terms must be accepted' using errcode = '23514';
  end if;

  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  update public.profiles set role = 'teacher' where id = p_user_id;

  insert into public.teacher_profiles (
    user_id,
    slug,
    hourly_price,
    profile_status,
    claimed_at,
    terms_accepted_at
  )
  values (p_user_id, p_slug, 0, 'draft', now(), now())
  on conflict (user_id) do update set
    claimed_at = coalesce(public.teacher_profiles.claimed_at, excluded.claimed_at),
    terms_accepted_at = coalesce(
      public.teacher_profiles.terms_accepted_at,
      excluded.terms_accepted_at
    );

  return query
  select * from public.teacher_profiles where user_id = p_user_id;
end;
$$;

create or replace function public.publish_teacher(
  p_teacher_id uuid,
  p_user_id uuid
)
returns setof public.teacher_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  teacher public.teacher_profiles%rowtype;
  profile public.profiles%rowtype;
begin
  select * into teacher
  from public.teacher_profiles
  where id = p_teacher_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'teacher profile not found' using errcode = 'P0002';
  end if;
  if teacher.profile_status = 'suspended' then
    raise exception 'suspended profile cannot be published' using errcode = '42501';
  end if;
  if teacher.claimed_at is null or teacher.terms_accepted_at is null then
    raise exception 'profile must be claimed and terms accepted'
      using errcode = '23514';
  end if;

  select * into profile from public.profiles where id = p_user_id;
  if profile.id is null
    or btrim(profile.first_name) = ''
    or btrim(profile.last_name) = '' then
    raise exception 'first and last name are required' using errcode = '23514';
  end if;
  if profile.avatar_path is null or btrim(profile.avatar_path) = '' then
    raise exception 'avatar is required' using errcode = '23514';
  end if;
  if btrim(teacher.headline) = '' then
    raise exception 'headline is required' using errcode = '23514';
  end if;
  if btrim(teacher.bio) = '' then
    raise exception 'bio is required' using errcode = '23514';
  end if;
  if teacher.hourly_price <= 0 then
    raise exception 'hourly price must be greater than zero' using errcode = '23514';
  end if;
  if not teacher.teaches_online and not teacher.teaches_in_person then
    raise exception 'at least one teaching mode is required' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.teacher_subjects where teacher_id = teacher.id
  ) then
    raise exception 'at least one subject is required' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.teacher_levels where teacher_id = teacher.id
  ) then
    raise exception 'at least one level is required' using errcode = '23514';
  end if;
  if not teacher.teaches_online and not exists (
    select 1 from public.teacher_availability
    where teacher_id = teacher.id and is_active
  ) then
    raise exception 'availability is required for in-person-only teachers'
      using errcode = '23514';
  end if;
  if teacher.teaches_in_person and not exists (
    select 1 from public.teacher_service_areas where teacher_id = teacher.id
  ) then
    raise exception 'at least one service area is required for in-person teaching'
      using errcode = '23514';
  end if;

  update public.teacher_profiles
  set profile_status = 'published', published_at = coalesce(published_at, now())
  where id = teacher.id;

  return query select * from public.teacher_profiles where id = teacher.id;
end;
$$;

create or replace function public.persist_matches(
  p_request_id uuid,
  p_matches jsonb
)
returns setof public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_request public.student_requests%rowtype;
  match_count integer;
begin
  if jsonb_typeof(p_matches) <> 'array' then
    raise exception 'matches must be an array' using errcode = '22023';
  end if;
  match_count = jsonb_array_length(p_matches);
  if match_count > 5 then
    raise exception 'at most five matches may be persisted' using errcode = '23514';
  end if;

  select * into target_request
  from public.student_requests
  where id = p_request_id and status in ('open', 'matched')
  for update;
  if not found then
    raise exception 'open request not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_matches) as item(teacher_id uuid)
    left join public.teacher_profiles teacher on teacher.id = item.teacher_id
    where teacher.id is null
      or teacher.profile_status <> 'published'
      or (target_request.budget_min is not null and teacher.hourly_price < target_request.budget_min)
      or (target_request.budget_max is not null and teacher.hourly_price > target_request.budget_max)
      or not exists (
        select 1 from public.teacher_subjects
        where teacher_id = teacher.id and subject_id = target_request.subject_id
      )
      or (
        target_request.level_id is not null
        and not exists (
          select 1 from public.teacher_levels
          where teacher_id = teacher.id and level_id = target_request.level_id
        )
      )
      or not (
        (target_request.online_ok and teacher.teaches_online)
        or (
          target_request.in_person_ok
          and teacher.teaches_in_person
          and (
            target_request.city_id is null
            or exists (
              select 1 from public.teacher_service_areas
              where teacher_id = teacher.id and city_id = target_request.city_id
            )
          )
        )
      )
  ) then
    raise exception 'one or more match candidates fail hard filters'
      using errcode = '23514';
  end if;

  delete from public.matches where request_id = p_request_id;

  insert into public.matches (
    request_id,
    teacher_id,
    score,
    rank,
    subject_score,
    availability_score,
    location_score,
    budget_score,
    quality_score
  )
  select
    p_request_id,
    item.teacher_id,
    item.score,
    item.rank,
    item.subject_score,
    item.availability_score,
    item.location_score,
    item.budget_score,
    item.quality_score
  from jsonb_to_recordset(p_matches) as item(
    teacher_id uuid,
    score numeric,
    rank integer,
    subject_score numeric,
    availability_score numeric,
    location_score numeric,
    budget_score numeric,
    quality_score numeric
  );

  update public.student_requests
  set status = case when match_count = 0 then 'open' else 'matched' end
  where id = p_request_id;

  return query
  select * from public.matches where request_id = p_request_id order by rank;
end;
$$;

create or replace function public.create_inquiry(
  p_student_id uuid,
  p_teacher_id uuid,
  p_request_id uuid,
  p_message text
)
returns setof public.inquiries
language plpgsql
security definer
set search_path = ''
as $$
declare
  inquiry_id uuid;
  teacher_user_id uuid;
begin
  if p_message is null or btrim(p_message) = '' then
    raise exception 'message is required' using errcode = '23514';
  end if;

  select user_id into teacher_user_id
  from public.teacher_profiles
  where id = p_teacher_id and profile_status = 'published'
  for update;
  if not found then
    raise exception 'teacher is not accepting inquiries' using errcode = 'P0002';
  end if;
  if p_student_id = teacher_user_id then
    raise exception 'teachers cannot inquire about their own profile'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.inquiries
    where student_id = p_student_id
      and teacher_id = p_teacher_id
      and status in ('sent', 'viewed')
      and created_at > now() - interval '24 hours'
  ) then
    raise exception 'an active inquiry already exists' using errcode = '23505';
  end if;
  if p_request_id is not null and not exists (
    select 1
    from public.student_requests request
    join public.matches match
      on match.request_id = request.id and match.teacher_id = p_teacher_id
    where request.id = p_request_id
      and request.student_id = p_student_id
      and request.status = 'matched'
  ) then
    raise exception 'matched request not found' using errcode = 'P0002';
  end if;

  insert into public.inquiries (student_id, teacher_id, request_id, message)
  values (p_student_id, p_teacher_id, p_request_id, btrim(p_message))
  returning id into inquiry_id;

  update public.matches set status = 'contacted'
  where request_id = p_request_id and teacher_id = p_teacher_id;

  insert into public.notifications (
    user_id, type, title, body, entity_type, entity_id
  ) values (
    teacher_user_id,
    'inquiry_received',
    'New student inquiry',
    'A student sent you a new inquiry.',
    'inquiry',
    inquiry_id
  );

  return query select * from public.inquiries where id = inquiry_id;
end;
$$;

create or replace function public.respond_to_inquiry(
  p_inquiry_id uuid,
  p_teacher_user_id uuid,
  p_status public.inquiry_status
)
returns setof public.inquiries
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_teacher_id uuid;
  target_student_id uuid;
begin
  if p_status not in ('accepted', 'declined') then
    raise exception 'response status must be accepted or declined'
      using errcode = '22023';
  end if;

  update public.inquiries inquiry
  set
    status = p_status,
    viewed_at = coalesce(inquiry.viewed_at, now()),
    responded_at = now()
  from public.teacher_profiles teacher
  where inquiry.id = p_inquiry_id
    and inquiry.teacher_id = teacher.id
    and teacher.user_id = p_teacher_user_id
    and inquiry.status in ('sent', 'viewed')
  returning inquiry.teacher_id, inquiry.student_id
  into target_teacher_id, target_student_id;

  if target_teacher_id is null then
    raise exception 'respondable inquiry not found' using errcode = 'P0002';
  end if;

  update public.teacher_profiles teacher
  set
    response_rate = metrics.response_rate,
    response_time_minutes = metrics.response_time_minutes
  from (
    select
      round(
        count(*) filter (where responded_at is not null)::numeric
        * 100 / nullif(count(*), 0),
        2
      ) as response_rate,
      round(
        avg(extract(epoch from (responded_at - created_at)) / 60)
          filter (where responded_at is not null)
      )::integer as response_time_minutes
    from public.inquiries
    where teacher_id = target_teacher_id
  ) metrics
  where teacher.id = target_teacher_id;

  insert into public.notifications (
    user_id, type, title, body, entity_type, entity_id
  ) values (
    target_student_id,
    case
      when p_status = 'accepted' then 'inquiry_accepted'::public.notification_type
      else 'inquiry_declined'::public.notification_type
    end,
    case when p_status = 'accepted' then 'Inquiry accepted' else 'Inquiry declined' end,
    case
      when p_status = 'accepted' then 'The teacher accepted your inquiry.'
      else 'The teacher declined your inquiry.'
    end,
    'inquiry',
    p_inquiry_id
  );

  return query select * from public.inquiries where id = p_inquiry_id;
end;
$$;

create or replace function public.submit_verified_review(
  p_student_id uuid,
  p_inquiry_id uuid,
  p_rating smallint,
  p_body text
)
returns setof public.reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_inquiry public.inquiries%rowtype;
  review_id uuid;
  teacher_user_id uuid;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'rating must be between 1 and 5' using errcode = '23514';
  end if;

  select * into target_inquiry
  from public.inquiries
  where id = p_inquiry_id
    and student_id = p_student_id
    and status = 'accepted'
  for update;
  if not found then
    raise exception 'accepted inquiry not found' using errcode = 'P0002';
  end if;

  insert into public.reviews (
    student_id, teacher_id, inquiry_id, rating, body, status
  ) values (
    p_student_id,
    target_inquiry.teacher_id,
    target_inquiry.id,
    p_rating,
    nullif(btrim(p_body), ''),
    'published'
  )
  returning id into review_id;

  select user_id into teacher_user_id
  from public.teacher_profiles where id = target_inquiry.teacher_id;
  insert into public.notifications (
    user_id, type, title, body, entity_type, entity_id
  ) values (
    teacher_user_id,
    'review_received',
    'New review',
    'A student published a review of your teaching.',
    'review',
    review_id
  );

  return query select * from public.reviews where id = review_id;
end;
$$;

create function public.expire_stale_inquiries()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_count integer;
begin
  with expired as (
    update public.inquiries
    set status = 'expired'
    where status in ('sent', 'viewed')
      and created_at < now() - interval '14 days'
    returning id, student_id
  ), notified as (
    insert into public.notifications (
      user_id, type, title, body, entity_type, entity_id
    )
    select
      student_id,
      'inquiry_expired',
      'Inquiry expired',
      'Your unanswered inquiry expired after 14 days.',
      'inquiry',
      id
    from expired
    returning 1
  )
  select count(*) into expired_count from notified;

  return expired_count;
end;
$$;

revoke execute on function public.create_teacher_draft(uuid, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.expire_stale_inquiries()
  from public, anon, authenticated;
grant execute on function public.create_teacher_draft(uuid, text, boolean)
  to service_role;
grant execute on function public.expire_stale_inquiries() to service_role;

commit;