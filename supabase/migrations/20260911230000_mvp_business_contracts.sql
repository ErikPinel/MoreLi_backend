begin;

alter table public.reviews
  add column inquiry_id uuid references public.inquiries (id) on delete restrict;

create unique index reviews_inquiry_id_key
  on public.reviews (inquiry_id)
  where inquiry_id is not null;

create function public.replace_teacher_subjects(
  p_teacher_id uuid,
  p_subjects jsonb
)
returns setof public.teacher_subjects
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  if jsonb_typeof(p_subjects) <> 'array' then
    raise exception 'subjects must be an array' using errcode = '22023';
  end if;

  perform 1
  from public.teacher_profiles
  where id = p_teacher_id
  for update;

  if not found then
    raise exception 'teacher profile not found' using errcode = 'P0002';
  end if;

  delete from public.teacher_subjects where teacher_id = p_teacher_id;

  insert into public.teacher_subjects (
    teacher_id,
    subject_id,
    experience_years,
    description
  )
  select
    p_teacher_id,
    item.subject_id,
    item.experience_years,
    item.description
  from jsonb_to_recordset(p_subjects) as item(
    subject_id bigint,
    experience_years integer,
    description text
  )
  join public.subjects on subjects.id = item.subject_id
  where subjects.is_active;

  get diagnostics inserted_count = row_count;
  if inserted_count <> jsonb_array_length(p_subjects) then
    raise exception 'one or more subjects are invalid or inactive'
      using errcode = '23514';
  end if;

  return query
  select * from public.teacher_subjects where teacher_id = p_teacher_id;
end;
$$;

create function public.replace_teacher_levels(
  p_teacher_id uuid,
  p_level_ids bigint[]
)
returns setof public.teacher_levels
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  perform 1
  from public.teacher_profiles
  where id = p_teacher_id
  for update;

  if not found then
    raise exception 'teacher profile not found' using errcode = 'P0002';
  end if;

  delete from public.teacher_levels where teacher_id = p_teacher_id;

  insert into public.teacher_levels (teacher_id, level_id)
  select p_teacher_id, levels.id
  from unnest(coalesce(p_level_ids, array[]::bigint[])) as requested(id)
  join public.levels on levels.id = requested.id
  where levels.is_active;

  get diagnostics inserted_count = row_count;
  if inserted_count <> cardinality(coalesce(p_level_ids, array[]::bigint[])) then
    raise exception 'one or more levels are invalid or inactive'
      using errcode = '23514';
  end if;

  return query
  select * from public.teacher_levels where teacher_id = p_teacher_id;
end;
$$;

create function public.replace_teacher_service_areas(
  p_teacher_id uuid,
  p_city_ids bigint[]
)
returns setof public.teacher_service_areas
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  perform 1
  from public.teacher_profiles
  where id = p_teacher_id
  for update;

  if not found then
    raise exception 'teacher profile not found' using errcode = 'P0002';
  end if;

  delete from public.teacher_service_areas where teacher_id = p_teacher_id;

  insert into public.teacher_service_areas (teacher_id, city_id)
  select p_teacher_id, cities.id
  from unnest(coalesce(p_city_ids, array[]::bigint[])) as requested(id)
  join public.cities on cities.id = requested.id
  where cities.is_active;

  get diagnostics inserted_count = row_count;
  if inserted_count <> cardinality(coalesce(p_city_ids, array[]::bigint[])) then
    raise exception 'one or more cities are invalid or inactive'
      using errcode = '23514';
  end if;

  return query
  select * from public.teacher_service_areas where teacher_id = p_teacher_id;
end;
$$;

create function public.prevent_availability_overlap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1
  from public.teacher_profiles
  where id = new.teacher_id
  for update;

  if new.is_active and exists (
    select 1
    from public.teacher_availability existing
    where existing.teacher_id = new.teacher_id
      and existing.day_of_week = new.day_of_week
      and existing.is_active
      and existing.id <> coalesce(new.id, 0)
      and new.start_time < existing.end_time
      and new.end_time > existing.start_time
  ) then
    raise exception 'availability slots cannot overlap' using errcode = '23P01';
  end if;

  return new;
end;
$$;

create trigger teacher_availability_prevent_overlap
before insert or update on public.teacher_availability
for each row execute function public.prevent_availability_overlap();

create function public.replace_teacher_availability(
  p_teacher_id uuid,
  p_slots jsonb
)
returns setof public.teacher_availability
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(p_slots) <> 'array' then
    raise exception 'availability must be an array' using errcode = '22023';
  end if;

  perform 1
  from public.teacher_profiles
  where id = p_teacher_id
  for update;

  if not found then
    raise exception 'teacher profile not found' using errcode = 'P0002';
  end if;

  delete from public.teacher_availability where teacher_id = p_teacher_id;

  insert into public.teacher_availability (
    teacher_id,
    day_of_week,
    start_time,
    end_time,
    timezone,
    is_active
  )
  select
    p_teacher_id,
    item.day_of_week,
    item.start_time,
    item.end_time,
    coalesce(item.timezone, 'Asia/Jerusalem'),
    coalesce(item.is_active, true)
  from jsonb_to_recordset(p_slots) as item(
    day_of_week smallint,
    start_time time,
    end_time time,
    timezone varchar(100),
    is_active boolean
  );

  return query
  select *
  from public.teacher_availability
  where teacher_id = p_teacher_id
  order by day_of_week, start_time;
end;
$$;

create function public.publish_teacher(
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

  select * into profile from public.profiles where id = p_user_id;

  if btrim(profile.first_name) = '' or btrim(profile.last_name) = '' then
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
    select 1
    from public.teacher_availability
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
  set
    profile_status = 'published',
    published_at = coalesce(published_at, now())
  where id = teacher.id;

  return query select * from public.teacher_profiles where id = teacher.id;
end;
$$;

create function public.persist_matches(
  p_request_id uuid,
  p_matches jsonb
)
returns setof public.matches
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(p_matches) <> 'array' then
    raise exception 'matches must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_matches) > 5 then
    raise exception 'at most five matches may be persisted' using errcode = '23514';
  end if;

  perform 1
  from public.student_requests
  where id = p_request_id and status in ('open', 'matched')
  for update;

  if not found then
    raise exception 'open request not found' using errcode = 'P0002';
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
  )
  join public.teacher_profiles teacher on teacher.id = item.teacher_id
  where teacher.profile_status = 'published';

  if (select count(*) from public.matches where request_id = p_request_id)
    <> jsonb_array_length(p_matches) then
    raise exception 'one or more match candidates are not published'
      using errcode = '23514';
  end if;

  update public.student_requests
  set status = 'matched'
  where id = p_request_id;

  return query
  select *
  from public.matches
  where request_id = p_request_id
  order by rank;
end;
$$;

create function public.mark_inquiry_viewed(
  p_inquiry_id uuid,
  p_teacher_user_id uuid
)
returns setof public.inquiries
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.inquiries inquiry
  set
    status = case when inquiry.status = 'sent' then 'viewed' else inquiry.status end,
    viewed_at = coalesce(inquiry.viewed_at, now())
  from public.teacher_profiles teacher
  where inquiry.id = p_inquiry_id
    and inquiry.teacher_id = teacher.id
    and teacher.user_id = p_teacher_user_id
    and inquiry.status in ('sent', 'viewed');

  if not found then
    raise exception 'viewable inquiry not found' using errcode = 'P0002';
  end if;

  return query select * from public.inquiries where id = p_inquiry_id;
end;
$$;

create function public.respond_to_inquiry(
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
  returning inquiry.teacher_id into target_teacher_id;

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
        * 100
        / nullif(count(*), 0),
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

  return query select * from public.inquiries where id = p_inquiry_id;
end;
$$;

create function public.refresh_teacher_review_aggregates()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  affected_teacher_id uuid;
begin
  affected_teacher_id = coalesce(new.teacher_id, old.teacher_id);

  update public.teacher_profiles teacher
  set
    average_rating = aggregates.average_rating,
    review_count = aggregates.review_count
  from (
    select
      coalesce(round(avg(rating)::numeric, 2), 0) as average_rating,
      count(*)::integer as review_count
    from public.reviews
    where teacher_id = affected_teacher_id and status = 'published'
  ) aggregates
  where teacher.id = affected_teacher_id;

  if tg_op = 'UPDATE' and old.teacher_id <> new.teacher_id then
    update public.teacher_profiles teacher
    set
      average_rating = aggregates.average_rating,
      review_count = aggregates.review_count
    from (
      select
        coalesce(round(avg(rating)::numeric, 2), 0) as average_rating,
        count(*)::integer as review_count
      from public.reviews
      where teacher_id = old.teacher_id and status = 'published'
    ) aggregates
    where teacher.id = old.teacher_id;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger reviews_refresh_teacher_aggregates
after insert or update or delete on public.reviews
for each row execute function public.refresh_teacher_review_aggregates();

create function public.submit_verified_review(
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
  inquiry public.inquiries%rowtype;
  review_id uuid;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'rating must be between 1 and 5' using errcode = '23514';
  end if;

  select * into inquiry
  from public.inquiries
  where id = p_inquiry_id
    and student_id = p_student_id
    and status = 'accepted'
  for update;

  if not found then
    raise exception 'accepted inquiry not found' using errcode = 'P0002';
  end if;

  insert into public.reviews (
    student_id,
    teacher_id,
    inquiry_id,
    rating,
    body,
    status
  ) values (
    p_student_id,
    inquiry.teacher_id,
    inquiry.id,
    p_rating,
    nullif(btrim(p_body), ''),
    'published'
  )
  returning id into review_id;

  return query select * from public.reviews where id = review_id;
end;
$$;

revoke execute on function public.replace_teacher_subjects(uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.replace_teacher_levels(uuid, bigint[])
  from public, anon, authenticated;
revoke execute on function public.replace_teacher_service_areas(uuid, bigint[])
  from public, anon, authenticated;
revoke execute on function public.replace_teacher_availability(uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.publish_teacher(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.persist_matches(uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.mark_inquiry_viewed(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.respond_to_inquiry(uuid, uuid, public.inquiry_status)
  from public, anon, authenticated;
revoke execute on function public.submit_verified_review(uuid, uuid, smallint, text)
  from public, anon, authenticated;
revoke execute on function public.prevent_availability_overlap()
  from public, anon, authenticated;
revoke execute on function public.refresh_teacher_review_aggregates()
  from public, anon, authenticated;

grant execute on function public.replace_teacher_subjects(uuid, jsonb)
  to service_role;
grant execute on function public.replace_teacher_levels(uuid, bigint[])
  to service_role;
grant execute on function public.replace_teacher_service_areas(uuid, bigint[])
  to service_role;
grant execute on function public.replace_teacher_availability(uuid, jsonb)
  to service_role;
grant execute on function public.publish_teacher(uuid, uuid)
  to service_role;
grant execute on function public.persist_matches(uuid, jsonb)
  to service_role;
grant execute on function public.mark_inquiry_viewed(uuid, uuid)
  to service_role;
grant execute on function public.respond_to_inquiry(uuid, uuid, public.inquiry_status)
  to service_role;
grant execute on function public.submit_verified_review(uuid, uuid, smallint, text)
  to service_role;

commit;