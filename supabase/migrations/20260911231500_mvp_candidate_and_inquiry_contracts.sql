begin;

create function public.create_teacher_draft(
  p_user_id uuid,
  p_slug text
)
returns setof public.teacher_profiles
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  update public.profiles set role = 'teacher' where id = p_user_id;

  insert into public.teacher_profiles (user_id, slug, hourly_price, profile_status)
  values (p_user_id, p_slug, 0, 'draft')
  on conflict (user_id) do nothing;

  return query
  select * from public.teacher_profiles where user_id = p_user_id;
end;
$$;

create function public.search_teacher_candidates(
  p_subject_id bigint default null,
  p_level_id bigint default null,
  p_city_id bigint default null,
  p_online_ok boolean default true,
  p_in_person_ok boolean default true,
  p_budget_min integer default null,
  p_budget_max integer default null,
  p_limit integer default 21,
  p_offset integer default 0
)
returns setof public.teacher_profiles
language sql
stable
security definer
set search_path = ''
as $$
  select teacher.*
  from public.teacher_profiles teacher
  where teacher.profile_status = 'published'
    and (
      p_subject_id is null
      or exists (
        select 1
        from public.teacher_subjects teacher_subject
        join public.subjects subject on subject.id = teacher_subject.subject_id
        where teacher_subject.teacher_id = teacher.id
          and teacher_subject.subject_id = p_subject_id
          and subject.is_active
      )
    )
    and (
      p_level_id is null
      or exists (
        select 1
        from public.teacher_levels teacher_level
        join public.levels level on level.id = teacher_level.level_id
        where teacher_level.teacher_id = teacher.id
          and teacher_level.level_id = p_level_id
          and level.is_active
      )
    )
    and (p_budget_min is null or teacher.hourly_price >= p_budget_min)
    and (p_budget_max is null or teacher.hourly_price <= p_budget_max)
    and (
      (p_online_ok and teacher.teaches_online)
      or (
        p_in_person_ok
        and teacher.teaches_in_person
        and (
          p_city_id is null
          or exists (
            select 1
            from public.teacher_service_areas service_area
            join public.cities city on city.id = service_area.city_id
            where service_area.teacher_id = teacher.id
              and service_area.city_id = p_city_id
              and city.is_active
          )
        )
      )
    )
  order by
    teacher.average_rating desc,
    teacher.review_count desc,
    teacher.published_at desc nulls last,
    teacher.id
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0);
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
begin
  if jsonb_typeof(p_matches) <> 'array' then
    raise exception 'matches must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_matches) > 5 then
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

  update public.student_requests set status = 'matched' where id = p_request_id;

  return query
  select * from public.matches where request_id = p_request_id order by rank;
end;
$$;

create function public.create_inquiry(
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
begin
  if p_message is null or btrim(p_message) = '' then
    raise exception 'message is required' using errcode = '23514';
  end if;

  perform 1
  from public.teacher_profiles
  where id = p_teacher_id and profile_status = 'published'
  for update;
  if not found then
    raise exception 'teacher is not accepting inquiries' using errcode = 'P0002';
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

  update public.matches
  set status = 'contacted'
  where request_id = p_request_id and teacher_id = p_teacher_id;

  return query select * from public.inquiries where id = inquiry_id;
end;
$$;

create or replace function public.refresh_teacher_review_aggregates()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  affected_teacher_id uuid;
begin
  affected_teacher_id = case when tg_op = 'DELETE' then old.teacher_id else new.teacher_id end;

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

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.create_teacher_draft(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.search_teacher_candidates(
  bigint, bigint, bigint, boolean, boolean, integer, integer, integer, integer
) from public, anon, authenticated;
revoke execute on function public.create_inquiry(uuid, uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.create_teacher_draft(uuid, text) to service_role;
grant execute on function public.search_teacher_candidates(
  bigint, bigint, bigint, boolean, boolean, integer, integer, integer, integer
) to service_role;
grant execute on function public.create_inquiry(uuid, uuid, uuid, text)
  to service_role;

commit;