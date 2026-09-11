begin;

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
  set status = (
    case when match_count = 0 then 'open' else 'matched' end
  )::public.request_status
  where id = p_request_id;

  return query
  select * from public.matches where request_id = p_request_id order by rank;
end;
$$;

commit;