begin;

alter table public.reviews
  add column teacher_reply text,
  add column teacher_reply_status public.review_status,
  add column teacher_reply_at timestamptz,
  add constraint reviews_reply_length check (teacher_reply is null or char_length(teacher_reply) between 5 and 2000),
  add constraint reviews_reply_state check (
    (teacher_reply is null and teacher_reply_status is null and teacher_reply_at is null) or
    (teacher_reply is not null and teacher_reply_status is not null and teacher_reply_at is not null)
  );

create function public.edit_owned_review(p_review_id uuid, p_student_id uuid, p_rating smallint, p_body text)
returns setof public.reviews language plpgsql security definer set search_path = '' as $$
begin
  if p_rating is null or p_rating not between 1 and 5 or char_length(coalesce(p_body, '')) > 3000 then
    raise exception 'Invalid review content' using errcode = '23514';
  end if;
  return query update public.reviews set rating = p_rating, body = nullif(btrim(p_body), ''),
    status = 'pending', teacher_reply = null, teacher_reply_status = null, teacher_reply_at = null
    where id = p_review_id and student_id = p_student_id returning *;
  if not found then raise exception 'Review not found' using errcode = 'P0002'; end if;
end;
$$;

create function public.delete_owned_review(p_review_id uuid, p_student_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  delete from public.reviews where id = p_review_id and student_id = p_student_id;
  if not found then raise exception 'Review not found' using errcode = 'P0002'; end if;
  return true;
end;
$$;

create function public.reply_to_review(p_review_id uuid, p_teacher_user_id uuid, p_body text)
returns setof public.reviews language plpgsql security definer set search_path = '' as $$
begin
  if p_body is not null and char_length(btrim(p_body)) not between 5 and 2000 then
    raise exception 'Reply must contain 5 to 2000 characters' using errcode = '23514';
  end if;
  perform review.id from public.reviews review
    join public.teacher_profiles teacher on teacher.id = review.teacher_id
    where review.id = p_review_id and teacher.user_id = p_teacher_user_id
      and (review.status = 'published' or p_body is null)
    for update of review;
  if not found then raise exception 'Review not found' using errcode = 'P0002'; end if;
  return query update public.reviews set teacher_reply = btrim(p_body),
    teacher_reply_status = case when p_body is null then null else 'pending'::public.review_status end,
    teacher_reply_at = case when p_body is null then null else now() end
    where id = p_review_id returning *;
end;
$$;

create function public.moderate_review_reply(p_review_id uuid, p_actor_id uuid, p_status public.review_status)
returns setof public.reviews language plpgsql security definer set search_path = '' as $$
declare target public.reviews%rowtype;
begin
  if not exists (select 1 from public.profiles where id = p_actor_id and role = 'admin') then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if p_status not in ('published', 'rejected') or p_status is null then
    raise exception 'Invalid moderation status' using errcode = '23514';
  end if;
  select * into target from public.reviews where id = p_review_id and teacher_reply is not null for update;
  if not found then raise exception 'Reply not found' using errcode = 'P0002'; end if;
  update public.reviews set teacher_reply_status = p_status where id = p_review_id;
  if p_status = 'published' and target.teacher_reply_status is distinct from p_status then
    insert into public.notifications(user_id, type, title, body, entity_type, entity_id)
    values (target.student_id, 'review_received', 'המורה הגיב לביקורת שלכם',
      'תגובת המורה נבדקה ופורסמה בפרופיל המורה.', 'review', p_review_id);
  end if;
  return query select * from public.reviews where id = p_review_id;
end;
$$;

revoke execute on function public.edit_owned_review(uuid, uuid, smallint, text) from public, anon, authenticated;
revoke execute on function public.delete_owned_review(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.reply_to_review(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.moderate_review_reply(uuid, uuid, public.review_status) from public, anon, authenticated;
grant execute on function public.edit_owned_review(uuid, uuid, smallint, text) to service_role;
grant execute on function public.delete_owned_review(uuid, uuid) to service_role;
grant execute on function public.reply_to_review(uuid, uuid, text) to service_role;
grant execute on function public.moderate_review_reply(uuid, uuid, public.review_status) to service_role;

notify pgrst, 'reload schema';
commit;