begin;

alter table public.inquiries
  add column lesson_status text check (lesson_status in ('needs_scheduling','awaiting','completed','cancelled','no_show_reported')),
  add column student_completed_at timestamptz,
  add column teacher_completed_at timestamptz,
  add column lesson_updated_at timestamptz,
  add column lesson_note text check (char_length(lesson_note)<=1000);
update public.inquiries set lesson_status=case when requested_start_at is not null and requested_end_at is not null then 'awaiting' else 'needs_scheduling' end
where status='accepted';

create function public.guard_inquiry_lesson() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status='accepted' and (tg_op='INSERT' or old.status is distinct from 'accepted') then
    perform id from public.teacher_profiles where id=new.teacher_id for update;
    if new.requested_start_at is not null and exists(select 1 from public.inquiries other
      where other.teacher_id=new.teacher_id and other.id<>new.id and other.status='accepted'
        and other.lesson_status='awaiting' and other.requested_start_at<new.requested_end_at
        and other.requested_end_at>new.requested_start_at) then
      raise exception 'Lesson time conflicts with an accepted lesson' using errcode='23514';
    end if;
    new.lesson_status:=case when new.requested_start_at is not null and new.requested_end_at is not null then 'awaiting' else 'needs_scheduling' end;
    new.lesson_updated_at:=now();
  end if;
  return new;
end;
$$;
create trigger inquiries_lesson_state before insert or update of status on public.inquiries
for each row execute function public.guard_inquiry_lesson();

create function public.update_lesson_state(p_user_id uuid,p_inquiry_id uuid,p_action text,p_note text)
returns setof public.inquiries language plpgsql security definer set search_path = '' as $$
declare lesson public.inquiries%rowtype; teacher_user uuid; counterparty uuid; changed boolean:=false; title text; key text;
begin
  select teacher.user_id into teacher_user from public.inquiries inquiry join public.teacher_profiles teacher on teacher.id=inquiry.teacher_id
    where inquiry.id=p_inquiry_id and (inquiry.student_id=p_user_id or teacher.user_id=p_user_id);
  if not found then raise exception 'Lesson not found' using errcode='P0002'; end if;
  select * into lesson from public.inquiries where id=p_inquiry_id and status='accepted' for update;
  if not found then raise exception 'Accepted lesson not found' using errcode='P0002'; end if;
  if p_action not in ('confirm_completed','cancel','report_no_show') or p_action is null or char_length(coalesce(p_note,''))>1000 then
    raise exception 'Invalid lesson action' using errcode='23514';
  end if;
  counterparty:=case when p_user_id=lesson.student_id then teacher_user else lesson.student_id end;
  if p_action='confirm_completed' then
    if lesson.lesson_status='completed' then return query select * from public.inquiries where id=p_inquiry_id; return; end if;
    if lesson.lesson_status<>'awaiting' or lesson.requested_end_at is null or lesson.requested_end_at>now() then
      raise exception 'Confirm only after the selected lesson end; contact support for disputed lessons' using errcode='23514';
    end if;
    if p_user_id=lesson.student_id and lesson.student_completed_at is null then
      lesson.student_completed_at:=now(); changed:=true;
    elsif p_user_id=teacher_user and lesson.teacher_completed_at is null then
      lesson.teacher_completed_at:=now(); changed:=true;
    end if;
    if lesson.student_completed_at is not null and lesson.teacher_completed_at is not null then lesson.lesson_status:='completed'; end if;
    title:=case when lesson.lesson_status='completed' then 'השיעור אושר כמתקיים' else 'הצד השני אישר שהשיעור התקיים' end;
  elsif p_action='cancel' then
    if lesson.lesson_status='cancelled' then return query select * from public.inquiries where id=p_inquiry_id; return; end if;
    if lesson.lesson_status not in ('awaiting','needs_scheduling') or char_length(btrim(coalesce(p_note,'')))<5 then
      raise exception 'A cancellation reason is required for an active lesson' using errcode='23514';
    end if;
    lesson.lesson_status:='cancelled'; changed:=true; title:='התקבל עדכון על ביטול שיעור';
  else
    if lesson.lesson_status<>'awaiting' or lesson.requested_end_at is null or lesson.requested_end_at>now()
      or char_length(btrim(coalesce(p_note,'')))<5 then
      raise exception 'Report a no-show only after the selected lesson end, with a reason' using errcode='23514';
    end if;
    lesson.lesson_status:='no_show_reported'; changed:=true; title:='התקבל דיווח על אי-הגעה לשיעור';
  end if;
  if not changed then return query select * from public.inquiries where id=p_inquiry_id; return; end if;
  update public.inquiries set lesson_status=lesson.lesson_status,student_completed_at=lesson.student_completed_at,
    teacher_completed_at=lesson.teacher_completed_at,lesson_updated_at=now(),lesson_note=nullif(btrim(p_note),'') where id=p_inquiry_id;
  insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
    values(counterparty,'lesson_updated',title,'פרטי השיעור והאפשרויות להמשך נמצאים בפנייה.','inquiry',p_inquiry_id);
  key:='lesson:'||p_inquiry_id||':'||p_action||':'||p_user_id;
  perform public.enqueue_marketplace_email('lesson.updated',p_inquiry_id,lesson.student_id,'student',
    jsonb_build_object('status',lesson.lesson_status,'action',p_action,'start',lesson.requested_start_at,'end',lesson.requested_end_at,'note',p_note),key);
  perform public.enqueue_marketplace_email('lesson.updated',p_inquiry_id,teacher_user,'teacher',
    jsonb_build_object('status',lesson.lesson_status,'action',p_action,'start',lesson.requested_start_at,'end',lesson.requested_end_at,'note',p_note),key);
  perform public.enqueue_marketplace_email('lesson.updated',p_inquiry_id,null,'admin',
    jsonb_build_object('status',lesson.lesson_status,'action',p_action,'start',lesson.requested_start_at,'end',lesson.requested_end_at,'note',p_note),key);
  return query select * from public.inquiries where id=p_inquiry_id;
end;
$$;

create function public.guard_review_completed_lesson() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.inquiry_id is null or not exists(select 1 from public.inquiries where id=new.inquiry_id
    and student_id=new.student_id and teacher_id=new.teacher_id and status='accepted' and lesson_status='completed') then
    raise exception 'A review requires a lesson confirmed as completed by both participants' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger reviews_require_completed_lesson before insert on public.reviews
for each row execute function public.guard_review_completed_lesson();

revoke execute on function public.guard_inquiry_lesson() from public,anon,authenticated;
revoke execute on function public.update_lesson_state(uuid,uuid,text,text) from public,anon,authenticated;
revoke execute on function public.guard_review_completed_lesson() from public,anon,authenticated;
grant execute on function public.update_lesson_state(uuid,uuid,text,text) to service_role;

notify pgrst,'reload schema';
commit;