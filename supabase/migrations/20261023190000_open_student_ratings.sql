begin;

drop trigger reviews_require_completed_lesson on public.reviews;
drop function public.guard_review_completed_lesson();

create function public.guard_review_author() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=new.student_id and role in ('student','teacher')) then
    raise exception 'Student account required' using errcode='42501';
  end if;
  if not exists(select 1 from public.teacher_profiles where id=new.teacher_id
    and profile_status='published' and user_id<>new.student_id) then
    raise exception 'A published teacher other than yourself is required' using errcode='23514';
  end if;
  if char_length(coalesce(new.body,''))>3000 then
    raise exception 'Invalid review content' using errcode='23514';
  end if;
  new.body:=nullif(btrim(new.body),'');
  return new;
end;
$$;
create trigger reviews_require_student_author before insert on public.reviews
for each row execute function public.guard_review_author();

create function public.submit_teacher_review(p_student_id uuid,p_teacher_id uuid,p_rating smallint,p_body text)
returns setof public.reviews language plpgsql security definer set search_path='' as $$
declare
  saved public.reviews%rowtype;
  teacher_user uuid;
begin
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Rating must be between 1 and 5' using errcode='23514';
  end if;
  insert into public.reviews(student_id,teacher_id,rating,body,status)
  values(p_student_id,p_teacher_id,p_rating,p_body,'published') returning * into saved;
  select user_id into teacher_user from public.teacher_profiles where id=p_teacher_id;
  insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
  values(teacher_user,'review_received','התקבל דירוג חדש','תלמיד פרסם דירוג בפרופיל ההוראה שלכם.','review',saved.id);
  return next saved;
end;
$$;

revoke execute on function public.guard_review_author(),public.submit_teacher_review(uuid,uuid,smallint,text)
  from public,anon,authenticated;
grant execute on function public.submit_teacher_review(uuid,uuid,smallint,text) to service_role;
notify pgrst,'reload schema';
commit;
