alter table public.profiles
  add column if not exists city_id bigint references public.cities (id) on delete set null;

create index if not exists profiles_city_id_idx on public.profiles (city_id);

create or replace function public.submit_teacher_for_review(
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
  if profile.phone is null or btrim(profile.phone) = '' then
    raise exception 'phone is required' using errcode = '23514';
  end if;
  if profile.city_id is null then
    raise exception 'city of residence is required' using errcode = '23514';
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