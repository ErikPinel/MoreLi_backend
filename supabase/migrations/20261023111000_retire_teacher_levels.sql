begin;

-- Retain historical level rows, but do not require or use them in active workflows.
create or replace function public.submit_teacher_onboarding(p_user_id uuid, p_form jsonb)
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
  select jsonb_agg(jsonb_build_object('day_of_week', slot->'dayOfWeek', 'start_time', slot->>'startTime',
    'end_time', slot->>'endTime', 'timezone', 'Asia/Jerusalem', 'is_active', true)) into availability
    from jsonb_array_elements(p_form->'slots') slot;
  if coalesce(jsonb_array_length(subject_ids), 0) = 0 or coalesce(jsonb_array_length(availability), 0) = 0 then
    raise exception 'Subjects and weekly availability required' using errcode = '23514';
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
  perform public.replace_teacher_service_areas(teacher.id, coalesce(service_ids, array[]::bigint[]));
  perform public.replace_teacher_availability(teacher.id, availability);
  return query select * from public.submit_teacher_for_review(teacher.id, p_user_id);
end;
$$;

create or replace function public.save_teacher_profile(p_user_id uuid, p_form jsonb, p_submit_review boolean default false)
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
  availability jsonb;
  require_complete boolean;
begin
  select * into account from public.profiles where id = p_user_id for update;
  if not found or account.role <> 'teacher' then
    raise exception 'Teacher account required' using errcode = '42501';
  end if;
  select * into teacher from public.teacher_profiles where user_id = p_user_id for update;
  if not found then raise exception 'Teacher profile not found' using errcode = 'P0002'; end if;
  require_complete := p_submit_review or teacher.profile_status <> 'draft';
  if require_complete and (coalesce(btrim(p_form->>'firstName'), '') = '' or coalesce(btrim(p_form->>'lastName'), '') = ''
    or length(btrim(coalesce(p_form->>'phone', ''))) < 7
    or coalesce(btrim(p_form->>'headline'), '') = '' or coalesce(btrim(p_form->>'bio'), '') = ''
    or coalesce((p_form->>'hourlyPrice')::integer, 0) not between 1 and 100000
    or coalesce((p_form->>'yearsExperience')::integer, -1) not between 0 and 80) then
    raise exception 'Complete all required profile fields' using errcode = '23514';
  end if;
  if not coalesce((p_form->>'teachesOnline')::boolean, false) and not coalesce((p_form->>'teachesInPerson')::boolean, false) then
    raise exception 'Teaching mode required' using errcode = '23514';
  end if;
  if (require_complete or nullif(p_form->>'avatarPath', '') is not null) and not exists (select 1 from storage.objects where bucket_id = 'teacher-avatars'
    and name = p_form->>'avatarPath' and split_part(name, '/', 1) = p_user_id::text) then
    raise exception 'Owned uploaded avatar required' using errcode = '23514';
  end if;
  select id into residence_id from public.cities where slug = p_form->>'citySlug' and is_active;
  if residence_id is null and (require_complete or nullif(p_form->>'citySlug', '') is not null) then raise exception 'Active residence city required' using errcode = '23514'; end if;
  select jsonb_agg(jsonb_build_object('subject_id', catalog.id)) into subject_ids
    from jsonb_array_elements_text(p_form->'subjectSlugs') requested(slug)
    left join public.subjects catalog on catalog.slug = requested.slug and catalog.is_active;
  select array_agg(catalog.id) into service_ids
    from jsonb_array_elements_text(p_form->'citySlugs') requested(slug)
    left join public.cities catalog on catalog.slug = requested.slug and catalog.is_active;
  select jsonb_agg(jsonb_build_object('day_of_week', slot->'dayOfWeek', 'start_time', slot->>'startTime',
    'end_time', slot->>'endTime', 'timezone', 'Asia/Jerusalem', 'is_active', true)) into availability
    from jsonb_array_elements(p_form->'slots') slot;
  if require_complete and (coalesce(jsonb_array_length(subject_ids), 0) = 0 or coalesce(jsonb_array_length(availability), 0) = 0) then
    raise exception 'Subjects and weekly availability required' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(p_form->'slots') slot
    where coalesce(slot->>'timezone', 'Asia/Jerusalem') <> 'Asia/Jerusalem'
      or coalesce((slot->>'isActive')::boolean, true) is false)
    or exists (
      select 1 from jsonb_array_elements(availability) with ordinality first_slot(value, position)
      join jsonb_array_elements(availability) with ordinality second_slot(value, position)
        on first_slot.position < second_slot.position
        and first_slot.value->>'day_of_week' = second_slot.value->>'day_of_week'
        and (first_slot.value->>'start_time')::time < (second_slot.value->>'end_time')::time
        and (second_slot.value->>'start_time')::time < (first_slot.value->>'end_time')::time
    ) then
    raise exception 'Valid non-overlapping Israel weekly availability required' using errcode = '23514';
  end if;
  update public.profiles set first_name = btrim(p_form->>'firstName'), last_name = btrim(p_form->>'lastName'),
    phone = btrim(p_form->>'phone'), city_id = residence_id, avatar_path = nullif(p_form->>'avatarPath', '') where id = p_user_id;
  update public.teacher_profiles set headline = btrim(p_form->>'headline'), bio = btrim(p_form->>'bio'),
    hourly_price = (p_form->>'hourlyPrice')::integer, years_experience = (p_form->>'yearsExperience')::integer,
    teaches_online = (p_form->>'teachesOnline')::boolean, teaches_in_person = (p_form->>'teachesInPerson')::boolean,
    availability_customized = true where id = teacher.id;
  perform public.replace_teacher_subjects(teacher.id, coalesce(subject_ids, '[]'::jsonb));
  perform public.replace_teacher_service_areas(teacher.id, coalesce(service_ids, array[]::bigint[]));
  perform public.replace_teacher_availability(teacher.id, coalesce(availability, '[]'::jsonb));
  if p_submit_review then
    return query select * from public.submit_teacher_for_review(teacher.id, p_user_id);
  else
    return query select * from public.teacher_profiles where id = teacher.id;
  end if;
end;
$$;

create or replace function public.submit_teacher_for_review(p_teacher_id uuid, p_user_id uuid)
returns setof public.teacher_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  teacher public.teacher_profiles%rowtype;
  profile public.profiles%rowtype;
begin
  select * into teacher from public.teacher_profiles
  where id = p_teacher_id and user_id = p_user_id for update;
  if not found then raise exception 'teacher profile not found' using errcode = 'P0002'; end if;
  if teacher.profile_status = 'suspended' then
    raise exception 'suspended profile cannot be submitted' using errcode = '42501';
  end if;
  if teacher.profile_status = 'published' then
    return query select * from public.teacher_profiles where id = teacher.id;
    return;
  end if;
  if teacher.claimed_at is null or teacher.terms_accepted_at is null then
    raise exception 'profile must be claimed and terms accepted' using errcode = '23514';
  end if;
  select * into profile from public.profiles where id = p_user_id;
  if profile.id is null or btrim(profile.first_name) = '' or btrim(profile.last_name) = '' then
    raise exception 'first and last name are required' using errcode = '23514';
  end if;
  if profile.contact_email is null or btrim(profile.contact_email) = '' then
    raise exception 'contact email is required' using errcode = '23514';
  end if;
  if profile.phone is null or btrim(profile.phone) = '' then
    raise exception 'phone is required' using errcode = '23514';
  end if;
  if profile.city_id is null then raise exception 'city of residence is required' using errcode = '23514'; end if;
  if profile.avatar_path is null or btrim(profile.avatar_path) = '' then
    raise exception 'avatar is required' using errcode = '23514';
  end if;
  if btrim(teacher.headline) = '' or btrim(teacher.bio) = '' then
    raise exception 'headline and bio are required' using errcode = '23514';
  end if;
  if teacher.hourly_price <= 0 then
    raise exception 'hourly price must be greater than zero' using errcode = '23514';
  end if;
  if not teacher.teaches_online and not teacher.teaches_in_person then
    raise exception 'at least one teaching mode is required' using errcode = '23514';
  end if;
  if not exists (select 1 from public.teacher_subjects where teacher_id = teacher.id) then
    raise exception 'at least one subject is required' using errcode = '23514';
  end if;
  if teacher.teaches_in_person and not exists (select 1 from public.teacher_service_areas where teacher_id = teacher.id) then
    raise exception 'at least one service area is required for in-person teaching' using errcode = '23514';
  end if;
  update public.teacher_profiles set profile_status = 'pending', verification_status = 'pending' where id = teacher.id;
  return query select * from public.teacher_profiles where id = teacher.id;
end;
$$;

create or replace function public.assert_published_teacher_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_teacher_id uuid;
  teacher public.teacher_profiles%rowtype;
  profile public.profiles%rowtype;
begin
  case tg_table_schema || '.' || tg_table_name
    when 'public.teacher_profiles' then
      target_teacher_id = case when tg_op = 'DELETE' then old.id else new.id end;
    when 'public.profiles' then
      select id into target_teacher_id from public.teacher_profiles
      where user_id = case when tg_op = 'DELETE' then old.id else new.id end;
    when 'public.teacher_subjects' then
      target_teacher_id = case when tg_op = 'DELETE' then old.teacher_id else new.teacher_id end;
    when 'public.teacher_levels' then
      target_teacher_id = case when tg_op = 'DELETE' then old.teacher_id else new.teacher_id end;
    when 'public.teacher_service_areas' then
      target_teacher_id = case when tg_op = 'DELETE' then old.teacher_id else new.teacher_id end;
    when 'public.teacher_availability' then
      target_teacher_id = case when tg_op = 'DELETE' then old.teacher_id else new.teacher_id end;
    when 'storage.objects' then
      select teacher_profile.id into target_teacher_id
      from public.teacher_profiles teacher_profile
      join public.profiles user_profile on user_profile.id = teacher_profile.user_id
      where user_profile.avatar_path = old.name limit 1;
  end case;
  if target_teacher_id is null then return case when tg_op = 'DELETE' then old else new end; end if;
  select * into teacher from public.teacher_profiles where id = target_teacher_id;
  if not found or teacher.profile_status <> 'published' then return case when tg_op = 'DELETE' then old else new end; end if;
  select * into profile from public.profiles where id = teacher.user_id;
  if profile.id is null or btrim(profile.first_name) = '' or btrim(profile.last_name) = '' then
    raise exception 'published teacher requires first and last name' using errcode = '23514';
  end if;
  if profile.avatar_path is null or not exists (
    select 1 from storage.objects where bucket_id = 'teacher-avatars' and name = profile.avatar_path
  ) then
    raise exception 'published teacher requires an uploaded avatar' using errcode = '23514';
  end if;
  if teacher.claimed_at is null or teacher.terms_accepted_at is null then
    raise exception 'published teacher must be claimed with accepted terms' using errcode = '23514';
  end if;
  if btrim(teacher.headline) = '' or btrim(teacher.bio) = '' or teacher.hourly_price <= 0 then
    raise exception 'published teacher profile is incomplete' using errcode = '23514';
  end if;
  if not teacher.teaches_online and not teacher.teaches_in_person then
    raise exception 'published teacher requires a teaching mode' using errcode = '23514';
  end if;
  if not exists (select 1 from public.teacher_subjects teacher_subject where teacher_subject.teacher_id = teacher.id) then
    raise exception 'published teacher requires a subject' using errcode = '23514';
  end if;
  if teacher.teaches_in_person and not exists (select 1 from public.teacher_service_areas area where area.teacher_id = teacher.id) then
    raise exception 'in-person teacher requires a service area' using errcode = '23514';
  end if;
  if not teacher.teaches_online and not exists (select 1 from public.teacher_availability availability where availability.teacher_id = teacher.id and availability.is_active) then
    raise exception 'in-person-only teacher requires availability' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

commit;
