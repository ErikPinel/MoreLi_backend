begin;

alter table public.profiles
  add column if not exists contact_email text;

alter table public.inquiries
  add column if not exists requested_start_at timestamptz,
  add column if not exists requested_end_at timestamptz,
  add column if not exists lesson_mode text;

alter table public.inquiries
  drop constraint if exists inquiries_requested_time_check,
  add constraint inquiries_requested_time_check check (
    (requested_start_at is null and requested_end_at is null)
    or (
      requested_start_at is not null
      and requested_end_at is not null
      and requested_end_at > requested_start_at
      and requested_end_at <= requested_start_at + interval '4 hours'
    )
  ),
  drop constraint if exists inquiries_lesson_mode_check,
  add constraint inquiries_lesson_mode_check check (
    lesson_mode is null or lesson_mode in ('online', 'in_person')
  );

create index if not exists inquiries_teacher_schedule_idx
  on public.inquiries (teacher_id, requested_start_at)
  where status in ('sent', 'viewed', 'accepted');

create function public.submit_teacher_for_review(
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
  if not exists (select 1 from public.teacher_levels where teacher_id = teacher.id) then
    raise exception 'at least one level is required' using errcode = '23514';
  end if;
  if teacher.teaches_in_person and not exists (
    select 1 from public.teacher_service_areas where teacher_id = teacher.id
  ) then
    raise exception 'at least one service area is required for in-person teaching' using errcode = '23514';
  end if;

  update public.teacher_profiles
  set profile_status = 'pending', verification_status = 'pending'
  where id = teacher.id;

  return query select * from public.teacher_profiles where id = teacher.id;
end;
$$;

drop function public.create_inquiry(uuid, uuid, uuid, text);

create function public.create_inquiry(
  p_student_id uuid,
  p_teacher_id uuid,
  p_request_id uuid,
  p_message text,
  p_requested_start_at timestamptz default null,
  p_requested_end_at timestamptz default null,
  p_lesson_mode text default null
)
returns setof public.inquiries
language plpgsql
security definer
set search_path = ''
as $$
declare
  inquiry_id uuid;
  teacher public.teacher_profiles%rowtype;
begin
  if p_message is null or btrim(p_message) = '' then
    raise exception 'message is required' using errcode = '23514';
  end if;
  if (p_requested_start_at is null) <> (p_requested_end_at is null) then
    raise exception 'both requested lesson times are required' using errcode = '23514';
  end if;
  if p_requested_start_at is not null and p_requested_start_at <= now() then
    raise exception 'requested lesson time must be in the future' using errcode = '23514';
  end if;
  if p_requested_start_at is not null and p_lesson_mode is null then
    raise exception 'lesson mode is required for scheduled requests' using errcode = '23514';
  end if;

  select * into teacher
  from public.teacher_profiles
  where id = p_teacher_id and profile_status = 'published'
  for update;
  if not found then
    raise exception 'teacher is not accepting inquiries' using errcode = 'P0002';
  end if;
  if p_student_id = teacher.user_id then
    raise exception 'teachers cannot inquire about their own profile' using errcode = '23514';
  end if;
  if p_lesson_mode = 'online' and not teacher.teaches_online then
    raise exception 'teacher does not teach online' using errcode = '23514';
  end if;
  if p_lesson_mode = 'in_person' and not teacher.teaches_in_person then
    raise exception 'teacher does not teach in person' using errcode = '23514';
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
    join public.matches match on match.request_id = request.id and match.teacher_id = p_teacher_id
    where request.id = p_request_id
      and request.student_id = p_student_id
      and request.status = 'matched'
  ) then
    raise exception 'matched request not found' using errcode = 'P0002';
  end if;

  insert into public.inquiries (
    student_id, teacher_id, request_id, message,
    requested_start_at, requested_end_at, lesson_mode
  ) values (
    p_student_id, p_teacher_id, p_request_id, btrim(p_message),
    p_requested_start_at, p_requested_end_at, p_lesson_mode
  ) returning id into inquiry_id;

  update public.matches set status = 'contacted'
  where request_id = p_request_id and teacher_id = p_teacher_id;

  insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
  values (
    teacher.user_id,
    'inquiry_received',
    'New lesson request',
    'A student sent you a new lesson request.',
    'inquiry',
    inquiry_id
  );

  return query select * from public.inquiries where id = inquiry_id;
end;
$$;

create function public.approve_teacher_review(p_teacher_id uuid)
returns setof public.teacher_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  teacher public.teacher_profiles%rowtype;
begin
  update public.teacher_profiles
  set
    verification_status = 'verified',
    profile_status = 'published',
    published_at = coalesce(published_at, now())
  where id = p_teacher_id and profile_status = 'pending'
  returning * into teacher;

  if teacher.id is null then
    raise exception 'pending teacher profile not found' using errcode = 'P0002';
  end if;

  insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
  values (
    teacher.user_id,
    'teacher_verified',
    'Profile approved',
    'Your teacher profile was approved and is now visible to students.',
    'teacher',
    teacher.id
  );

  return query select * from public.teacher_profiles where id = teacher.id;
end;
$$;

revoke execute on function public.submit_teacher_for_review(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.create_inquiry(uuid, uuid, uuid, text, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.approve_teacher_review(uuid) from public, anon, authenticated;
grant execute on function public.submit_teacher_for_review(uuid, uuid) to service_role;
grant execute on function public.create_inquiry(uuid, uuid, uuid, text, timestamptz, timestamptz, text) to service_role;
grant execute on function public.approve_teacher_review(uuid) to service_role;

notify pgrst, 'reload schema';
commit;