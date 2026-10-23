-- Category search must agree with the distinct published teachers in each family.
with families as (
  select id, name_he from public.subjects where is_active and name_he like '% - הכל'
), expected as (
  select family.id, count(distinct teacher.id) as total
  from families family
  left join public.subjects offered
    on offered.is_active and (
      offered.id = family.id or offered.parent_id = family.id
      or family.name_he = split_part(offered.name_he, ' - ', 1) || ' - הכל'
    )
  left join public.teacher_subjects assignment on assignment.subject_id = offered.id
  left join public.teacher_profiles teacher on teacher.id = assignment.teacher_id and teacher.profile_status = 'published'
  group by family.id
)
select count(*) as category_count,
  count(*) filter (where total <> public.count_teacher_candidates_v2(p_subject_id => id)) as category_count_mismatches,
  (
    select public.count_teacher_candidates_v2(p_subject_id => subject.id)
    from public.subjects subject where subject.is_active and subject.name_he = 'מתמטיקה - הכל'
  ) as math_teacher_count,
  (
    select count(*) from public.cities city
    cross join lateral public.search_teacher_candidates_v2(
      p_city_id => city.id, p_online_ok => false, p_in_person_ok => true, p_limit => 200
    ) teacher
    where city.is_active and (
      not teacher.teaches_in_person or not exists (
        select 1 from public.teacher_service_areas area
        where area.teacher_id = teacher.id and area.city_id = city.id
      )
    )
  ) as invalid_local_results,
  (
    select count(*) from pg_proc routine
    where routine.pronamespace = 'public'::regnamespace and routine.proname in (
      'teacher_matches_subject', 'teacher_candidate_pool', 'search_teacher_candidates',
      'search_teacher_candidates_v2', 'count_teacher_candidates_v2', 'persist_matches',
      'submit_teacher_onboarding', 'save_teacher_profile', 'submit_teacher_for_review'
    ) and (
      has_function_privilege('anon', routine.oid, 'EXECUTE')
      or has_function_privilege('authenticated', routine.oid, 'EXECUTE')
      or not has_function_privilege('service_role', routine.oid, 'EXECUTE')
    )
  ) as invalid_rpc_grants,
  (
    select count(*) from pg_proc routine
    where routine.pronamespace = 'public'::regnamespace and routine.proname in (
      'teacher_candidate_pool', 'submit_teacher_onboarding', 'save_teacher_profile',
      'submit_teacher_for_review', 'persist_matches'
    ) and (
      strpos(pg_get_functiondef(routine.oid), 'levelIds') > 0
      or strpos(pg_get_functiondef(routine.oid), 'teacher_levels') > 0
    )
  ) as remaining_level_requirements
from expected;
