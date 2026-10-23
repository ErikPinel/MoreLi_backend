begin;

create function public.teacher_matches_subject(p_teacher_id uuid, p_subject_id bigint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.teacher_subjects teacher_subject
    join public.subjects offered on offered.id = teacher_subject.subject_id and offered.is_active
    join public.subjects requested on requested.id = p_subject_id and requested.is_active
    where teacher_subject.teacher_id = p_teacher_id
      and (
        offered.id = requested.id
        or offered.parent_id = requested.id
        or requested.name_he = split_part(offered.name_he, ' - ', 1) || ' - הכל'
      )
  );
$$;

create function public.teacher_candidate_pool(
  p_subject_id bigint,
  p_city_id bigint,
  p_online_ok boolean,
  p_in_person_ok boolean,
  p_budget_min integer,
  p_budget_max integer,
  p_verified_only boolean,
  p_rating_min numeric
)
returns setof public.teacher_profiles
language sql
stable
set search_path = ''
as $$
  select teacher.*
  from public.teacher_profiles teacher
  where teacher.profile_status = 'published'
    and (not p_verified_only or teacher.verification_status = 'verified')
    and (p_rating_min is null or teacher.average_rating >= p_rating_min)
    and (p_subject_id is null or public.teacher_matches_subject(teacher.id, p_subject_id))
    and (p_budget_min is null or teacher.hourly_price >= p_budget_min)
    and (p_budget_max is null or teacher.hourly_price <= p_budget_max)
    and (
      (p_online_ok and teacher.teaches_online)
      or (
        p_in_person_ok and teacher.teaches_in_person
        and (
          p_city_id is null
          or exists (
            select 1 from public.teacher_service_areas area
            join public.cities city on city.id = area.city_id and city.is_active
            where area.teacher_id = teacher.id and area.city_id = p_city_id
          )
        )
      )
    );
$$;

-- Keep the existing RPC signatures for compatibility; levels no longer filter results.
create or replace function public.search_teacher_candidates_v2(
  p_subject_id bigint default null,
  p_level_id bigint default null,
  p_city_id bigint default null,
  p_online_ok boolean default true,
  p_in_person_ok boolean default true,
  p_budget_min integer default null,
  p_budget_max integer default null,
  p_verified_only boolean default false,
  p_rating_min numeric default null,
  p_sort text default 'recommended',
  p_limit integer default 21,
  p_offset integer default 0
)
returns setof public.teacher_profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_sort not in ('recommended', 'rating', 'price_asc', 'price_desc') then
    raise exception 'unsupported teacher sort' using errcode = '22023';
  end if;
  return query
  select teacher.*
  from public.teacher_candidate_pool(
    p_subject_id, p_city_id, p_online_ok, p_in_person_ok,
    p_budget_min, p_budget_max, p_verified_only, p_rating_min
  ) teacher
  order by
    case when p_sort in ('recommended', 'rating') then teacher.average_rating end desc,
    case when p_sort in ('recommended', 'rating') then teacher.review_count end desc,
    case when p_sort = 'price_asc' then teacher.hourly_price end asc,
    case when p_sort = 'price_desc' then teacher.hourly_price end desc,
    teacher.published_at desc nulls last,
    teacher.id
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0);
end;
$$;

create or replace function public.count_teacher_candidates_v2(
  p_subject_id bigint default null,
  p_level_id bigint default null,
  p_city_id bigint default null,
  p_online_ok boolean default true,
  p_in_person_ok boolean default true,
  p_budget_min integer default null,
  p_budget_max integer default null,
  p_verified_only boolean default false,
  p_rating_min numeric default null
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from public.teacher_candidate_pool(
    p_subject_id, p_city_id, p_online_ok, p_in_person_ok,
    p_budget_min, p_budget_max, p_verified_only, p_rating_min
  );
$$;

create or replace function public.search_teacher_candidates(
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
  select * from public.search_teacher_candidates_v2(
    p_subject_id, null, p_city_id, p_online_ok, p_in_person_ok,
    p_budget_min, p_budget_max, false, null, 'recommended', p_limit, p_offset
  );
$$;

create or replace function public.persist_matches(p_request_id uuid, p_matches jsonb)
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
  select * into target_request from public.student_requests
  where id = p_request_id and status in ('open', 'matched') for update;
  if not found then
    raise exception 'open request not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_matches) as item(teacher_id uuid)
    left join public.teacher_profiles teacher on teacher.id = item.teacher_id
    where teacher.id is null
      or teacher.profile_status <> 'published'
      or (target_request.budget_min is not null and teacher.hourly_price < target_request.budget_min)
      or (target_request.budget_max is not null and teacher.hourly_price > target_request.budget_max)
      or not public.teacher_matches_subject(teacher.id, target_request.subject_id)
      or not (
        (target_request.online_ok and teacher.teaches_online)
        or (
          target_request.in_person_ok and teacher.teaches_in_person
          and (
            target_request.city_id is null
            or exists (
              select 1 from public.teacher_service_areas area
              join public.cities city on city.id = area.city_id and city.is_active
              where area.teacher_id = teacher.id and area.city_id = target_request.city_id
            )
          )
        )
      )
  ) then
    raise exception 'one or more match candidates fail hard filters' using errcode = '23514';
  end if;
  delete from public.matches where request_id = p_request_id;
  insert into public.matches (
    request_id, teacher_id, score, rank, subject_score,
    availability_score, location_score, budget_score, quality_score
  )
  select p_request_id, item.teacher_id, item.score, item.rank, item.subject_score,
    item.availability_score, item.location_score, item.budget_score, item.quality_score
  from jsonb_to_recordset(p_matches) as item(
    teacher_id uuid, score numeric, rank integer, subject_score numeric,
    availability_score numeric, location_score numeric, budget_score numeric, quality_score numeric
  );
  update public.student_requests
  set status = (case when match_count = 0 then 'open' else 'matched' end)::public.request_status
  where id = p_request_id;
  return query select * from public.matches where request_id = p_request_id order by rank;
end;
$$;

revoke execute on function public.teacher_matches_subject(uuid, bigint) from public, anon, authenticated;
revoke execute on function public.teacher_candidate_pool(bigint, bigint, boolean, boolean, integer, integer, boolean, numeric) from public, anon, authenticated;
revoke execute on function public.search_teacher_candidates(bigint, bigint, bigint, boolean, boolean, integer, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.search_teacher_candidates_v2(bigint, bigint, bigint, boolean, boolean, integer, integer, boolean, numeric, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.count_teacher_candidates_v2(bigint, bigint, bigint, boolean, boolean, integer, integer, boolean, numeric) from public, anon, authenticated;
revoke execute on function public.persist_matches(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.teacher_matches_subject(uuid, bigint) to service_role;
grant execute on function public.teacher_candidate_pool(bigint, bigint, boolean, boolean, integer, integer, boolean, numeric) to service_role;
grant execute on function public.search_teacher_candidates(bigint, bigint, bigint, boolean, boolean, integer, integer, integer, integer) to service_role;
grant execute on function public.search_teacher_candidates_v2(bigint, bigint, bigint, boolean, boolean, integer, integer, boolean, numeric, text, integer, integer) to service_role;
grant execute on function public.count_teacher_candidates_v2(bigint, bigint, bigint, boolean, boolean, integer, integer, boolean, numeric) to service_role;
grant execute on function public.persist_matches(uuid, jsonb) to service_role;

commit;
