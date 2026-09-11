begin;

create function public.moderate_teacher(
  p_teacher_id uuid,
  p_verification_status public.verification_status default null,
  p_profile_status public.teacher_profile_status default null
)
returns setof public.teacher_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  teacher public.teacher_profiles%rowtype;
begin
  select * into teacher
  from public.teacher_profiles
  where id = p_teacher_id
  for update;
  if not found then
    raise exception 'teacher profile not found' using errcode = 'P0002';
  end if;

  if p_profile_status = 'published' and teacher.published_at is null then
    raise exception 'an unpublished profile cannot be reinstated directly'
      using errcode = '23514';
  end if;

  update public.teacher_profiles
  set
    verification_status = coalesce(p_verification_status, verification_status),
    profile_status = coalesce(p_profile_status, profile_status)
  where id = p_teacher_id
  returning * into teacher;

  if p_verification_status = 'verified' then
    insert into public.notifications (
      user_id, type, title, body, entity_type, entity_id
    ) values (
      teacher.user_id,
      'teacher_verified',
      'Profile verified',
      'Your teacher profile has been verified.',
      'teacher',
      teacher.id
    );
  end if;

  if p_profile_status = 'suspended' then
    insert into public.notifications (
      user_id, type, title, body, entity_type, entity_id
    ) values (
      teacher.user_id,
      'teacher_suspended',
      'Profile suspended',
      'Your teacher profile has been suspended. Contact support for details.',
      'teacher',
      teacher.id
    );
  end if;

  return query select * from public.teacher_profiles where id = p_teacher_id;
end;
$$;

create function public.moderate_review(
  p_review_id uuid,
  p_status public.review_status
)
returns setof public.reviews
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('published', 'rejected') then
    raise exception 'moderation status must be published or rejected'
      using errcode = '22023';
  end if;

  return query
  update public.reviews
  set status = p_status
  where id = p_review_id
  returning *;

  if not found then
    raise exception 'review not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.moderate_teacher(
  uuid, public.verification_status, public.teacher_profile_status
) from public, anon, authenticated;
revoke execute on function public.moderate_review(uuid, public.review_status)
  from public, anon, authenticated;
grant execute on function public.moderate_teacher(
  uuid, public.verification_status, public.teacher_profile_status
) to service_role;
grant execute on function public.moderate_review(uuid, public.review_status)
  to service_role;

commit;