begin;

create function public.submit_teacher_onboarding(p_user_id uuid, p_form jsonb)
returns setof public.teacher_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.profiles%rowtype;
  teacher public.teacher_profiles%rowtype;
  residence_id bigint;
  subject_ids jsonb;
  service_ids bigint[];
  level_ids bigint[];
  availability jsonb;
begin
  select * into account from public.profiles where id = p_user_id for update;
  if not found or account.role not in ('student', 'teacher') then
    raise exception 'Student account required' using errcode = '42501';
  end if;
  select * into teacher from public.teacher_profiles where user_id = p_user_id;
  if found then
    if teacher.profile_status = 'pending' then
      return next teacher;
      return;
    end if;
    raise exception 'Use the existing teacher profile editor' using errcode = '23514';
  end if;
  if account.role <> 'student' or (p_form->>'acceptTerms')::boolean is not true then
    raise exception 'Student account and accepted terms required' using errcode = '23514';
  end if;
  if coalesce(btrim(p_form->>'firstName'), '') = '' or coalesce(btrim(p_form->>'lastName'), '') = ''
    or length(btrim(coalesce(p_form->>'phone', ''))) < 7
    or coalesce(btrim(p_form->>'headline'), '') = '' or coalesce(btrim(p_form->>'bio'), '') = ''
    or coalesce((p_form->>'hourlyPrice')::integer, 0) not between 1 and 100000
    or coalesce((p_form->>'yearsExperience')::integer, -1) not between 0 and 80 then
    raise exception 'Complete all required profile fields' using errcode = '23514';
  end if;
  if not coalesce((p_form->>'teachesOnline')::boolean, false) and not coalesce((p_form->>'teachesInPerson')::boolean, false) then
    raise exception 'Teaching mode required' using errcode = '23514';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'teacher-avatars'
    and name = p_form->>'avatarPath' and split_part(name, '/', 1) = p_user_id::text) then
    raise exception 'Owned uploaded avatar required' using errcode = '23514';
  end if;
  select id into residence_id from public.cities where slug = p_form->>'citySlug' and is_active;
  if residence_id is null then raise exception 'Active residence city required' using errcode = '23514'; end if;
  select jsonb_agg(jsonb_build_object('subject_id', catalog.id)) into subject_ids
    from jsonb_array_elements_text(p_form->'subjectSlugs') requested(slug)
    left join public.subjects catalog on catalog.slug = requested.slug and catalog.is_active;
  select array_agg(catalog.id) into service_ids
    from jsonb_array_elements_text(p_form->'citySlugs') requested(slug)
    left join public.cities catalog on catalog.slug = requested.slug and catalog.is_active;
  select array_agg(value::bigint) into level_ids from jsonb_array_elements_text(p_form->'levelIds');
  select jsonb_agg(jsonb_build_object('day_of_week', slot->'dayOfWeek', 'start_time', slot->>'startTime',
    'end_time', slot->>'endTime', 'timezone', 'Asia/Jerusalem', 'is_active', true)) into availability
    from jsonb_array_elements(p_form->'slots') slot;
  if coalesce(jsonb_array_length(subject_ids), 0) = 0 or coalesce(cardinality(level_ids), 0) = 0
    or coalesce(jsonb_array_length(availability), 0) = 0 then
    raise exception 'Subjects, levels and weekly availability required' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(availability) with ordinality first_slot(value, position)
    join jsonb_array_elements(availability) with ordinality second_slot(value, position)
      on first_slot.position < second_slot.position
      and first_slot.value->>'day_of_week' = second_slot.value->>'day_of_week'
      and (first_slot.value->>'start_time')::time < (second_slot.value->>'end_time')::time
      and (second_slot.value->>'start_time')::time < (first_slot.value->>'end_time')::time
  ) then
    raise exception 'Weekly availability must not overlap' using errcode = '23514';
  end if;
  update public.profiles set first_name = btrim(p_form->>'firstName'), last_name = btrim(p_form->>'lastName'),
    phone = btrim(p_form->>'phone'), city_id = residence_id, avatar_path = p_form->>'avatarPath' where id = p_user_id;
  select * into teacher from public.create_teacher_draft(p_user_id, 'teacher-' || replace(p_user_id::text, '-', ''), true);
  update public.teacher_profiles set headline = btrim(p_form->>'headline'), bio = btrim(p_form->>'bio'),
    hourly_price = (p_form->>'hourlyPrice')::integer, currency = 'ILS', years_experience = (p_form->>'yearsExperience')::integer,
    teaches_online = (p_form->>'teachesOnline')::boolean, teaches_in_person = (p_form->>'teachesInPerson')::boolean
    where id = teacher.id;
  perform public.replace_teacher_subjects(teacher.id, subject_ids);
  perform public.replace_teacher_levels(teacher.id, level_ids);
  perform public.replace_teacher_service_areas(teacher.id, coalesce(service_ids, array[]::bigint[]));
  perform public.replace_teacher_availability(teacher.id, availability);
  return query select * from public.submit_teacher_for_review(teacher.id, p_user_id);
end;
$$;

revoke execute on function public.submit_teacher_onboarding(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_teacher_onboarding(uuid, jsonb) to service_role;
revoke execute on function public.create_teacher_draft(uuid, text, boolean) from service_role;

commit;