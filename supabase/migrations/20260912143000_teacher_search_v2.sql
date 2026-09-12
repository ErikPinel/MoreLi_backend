begin;

create function public.search_teacher_candidates_v2(
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
  from public.teacher_profiles teacher
  where teacher.profile_status = 'published'
    and (not p_verified_only or teacher.verification_status = 'verified')
    and (p_rating_min is null or teacher.average_rating >= p_rating_min)
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

create function public.count_teacher_candidates_v2(
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
  select count(*)
  from public.teacher_profiles teacher
  where teacher.profile_status = 'published'
    and (not p_verified_only or teacher.verification_status = 'verified')
    and (p_rating_min is null or teacher.average_rating >= p_rating_min)
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
    );
$$;

revoke execute on function public.search_teacher_candidates_v2(
  bigint, bigint, bigint, boolean, boolean, integer, integer, boolean, numeric, text, integer, integer
) from public, anon, authenticated;
revoke execute on function public.count_teacher_candidates_v2(
  bigint, bigint, bigint, boolean, boolean, integer, integer, boolean, numeric
) from public, anon, authenticated;

grant execute on function public.search_teacher_candidates_v2(
  bigint, bigint, bigint, boolean, boolean, integer, integer, boolean, numeric, text, integer, integer
) to service_role;
grant execute on function public.count_teacher_candidates_v2(
  bigint, bigint, bigint, boolean, boolean, integer, integer, boolean, numeric
) to service_role;

commit;