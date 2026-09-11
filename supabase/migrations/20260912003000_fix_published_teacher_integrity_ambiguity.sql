begin;

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
      select id into target_teacher_id
      from public.teacher_profiles
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
      where user_profile.avatar_path = old.name
      limit 1;
  end case;

  if target_teacher_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select * into teacher
  from public.teacher_profiles
  where id = target_teacher_id;

  if not found or teacher.profile_status <> 'published' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select * into profile from public.profiles where id = teacher.user_id;
  if profile.id is null
    or btrim(profile.first_name) = ''
    or btrim(profile.last_name) = '' then
    raise exception 'published teacher requires first and last name'
      using errcode = '23514';
  end if;
  if profile.avatar_path is null
    or not exists (
      select 1 from storage.objects
      where bucket_id = 'teacher-avatars' and name = profile.avatar_path
    ) then
    raise exception 'published teacher requires an uploaded avatar'
      using errcode = '23514';
  end if;
  if teacher.claimed_at is null or teacher.terms_accepted_at is null then
    raise exception 'published teacher must be claimed with accepted terms'
      using errcode = '23514';
  end if;
  if btrim(teacher.headline) = ''
    or btrim(teacher.bio) = ''
    or teacher.hourly_price <= 0 then
    raise exception 'published teacher profile is incomplete'
      using errcode = '23514';
  end if;
  if not teacher.teaches_online and not teacher.teaches_in_person then
    raise exception 'published teacher requires a teaching mode'
      using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.teacher_subjects teacher_subject
    where teacher_subject.teacher_id = teacher.id
  ) then
    raise exception 'published teacher requires a subject' using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.teacher_levels teacher_level
    where teacher_level.teacher_id = teacher.id
  ) then
    raise exception 'published teacher requires a level' using errcode = '23514';
  end if;
  if teacher.teaches_in_person and not exists (
    select 1
    from public.teacher_service_areas service_area
    where service_area.teacher_id = teacher.id
  ) then
    raise exception 'in-person teacher requires a service area'
      using errcode = '23514';
  end if;
  if not teacher.teaches_online and not exists (
    select 1
    from public.teacher_availability availability
    where availability.teacher_id = teacher.id and availability.is_active
  ) then
    raise exception 'in-person-only teacher requires availability'
      using errcode = '23514';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

commit;