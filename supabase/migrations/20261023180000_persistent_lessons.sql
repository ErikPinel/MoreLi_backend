begin;
lock table public.inquiries in share row exclusive mode;

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teacher_profiles(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  connection_inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  source_inquiry_id uuid unique references public.inquiries(id) on delete cascade,
  request_key uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  mode text check (mode in ('online','in_person')),
  status text not null check (status in ('needs_scheduling','scheduled','completed','cancelled','no_show_reported')),
  student_completed_at timestamptz,
  teacher_completed_at timestamptz,
  note text,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_id,request_key),
  check (starts_at is null or ends_at is null or ends_at > starts_at),
  check (status <> 'scheduled' or (starts_at is not null and ends_at is not null))
);
create index lessons_teacher_time on public.lessons(teacher_id,starts_at,id);
create index lessons_student_time on public.lessons(student_id,starts_at,id);
alter table public.lessons enable row level security;
revoke all on public.lessons from anon,authenticated;
grant all on public.lessons to service_role;

-- Import recorded decisions verbatim, without running booking guards or sending messages.
insert into public.lessons(teacher_id,student_id,connection_inquiry_id,source_inquiry_id,
  starts_at,ends_at,mode,status,student_completed_at,teacher_completed_at,note,created_at,updated_at)
select teacher_id,student_id,id,id,requested_start_at,requested_end_at,lesson_mode,
  case when lesson_status in ('completed','cancelled','no_show_reported') then lesson_status
    when requested_start_at is not null and requested_end_at is not null then 'scheduled' else 'needs_scheduling' end,
  student_completed_at,teacher_completed_at,lesson_note,coalesce(responded_at,created_at),
  coalesce(lesson_updated_at,responded_at,created_at)
from public.inquiries where status='accepted';

create function public.guard_scheduled_lesson() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  teacher public.teacher_profiles%rowtype;
  local_start timestamp;
  local_end timestamp;
begin
  select * into teacher from public.teacher_profiles where id=new.teacher_id for update;
  perform 1 from public.profiles where id=new.student_id for update;
  if teacher.user_id=new.student_id or not exists(
    select 1 from public.inquiries where id=new.connection_inquiry_id and status='accepted'
      and teacher_id=new.teacher_id and student_id=new.student_id
  ) then raise exception 'LESSON_CONNECTION_REQUIRED' using errcode='42501'; end if;
  if tg_op='UPDATE' and (new.teacher_id,new.student_id,new.connection_inquiry_id,new.source_inquiry_id)
    is distinct from (old.teacher_id,old.student_id,old.connection_inquiry_id,old.source_inquiry_id) then
    raise exception 'LESSON_CONNECTION_IMMUTABLE' using errcode='23514';
  end if;
  if new.status='scheduled' and (tg_op='INSERT' or
    (new.starts_at,new.ends_at,new.mode) is distinct from (old.starts_at,old.ends_at,old.mode)) then
    if new.starts_at<=now() or new.mode is null or
      extract(epoch from (new.ends_at-new.starts_at))/60 not in (30,45,60,90,120,180,240) then
      raise exception 'LESSON_INVALID_TIME' using errcode='23514';
    end if;
    local_start:=new.starts_at at time zone 'Asia/Jerusalem';
    local_end:=new.ends_at at time zone 'Asia/Jerusalem';
    if local_start::date<>local_end::date or not (
      (not teacher.availability_customized and extract(dow from local_start) between 0 and 4
        and local_start::time>='09:00' and local_end::time<='21:00')
      or (teacher.availability_customized and exists(
        select 1 from public.teacher_availability where teacher_id=new.teacher_id and is_active
          and day_of_week=extract(dow from local_start) and start_time<=local_start::time and end_time>=local_end::time
      ))
    ) then raise exception 'LESSON_OUTSIDE_AVAILABILITY' using errcode='23514'; end if;
    if exists(select 1 from public.lessons l where l.id<>new.id and l.status='scheduled'
      and (l.teacher_id=new.teacher_id or l.student_id=new.student_id)
      and l.starts_at<new.ends_at and l.ends_at>new.starts_at) then
      raise exception 'LESSON_CONFLICT' using errcode='23P01';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_scheduled_lesson before insert or update on public.lessons
for each row execute function public.guard_scheduled_lesson();

create function public.create_accepted_inquiry_lesson() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='accepted' then
    insert into public.lessons(teacher_id,student_id,connection_inquiry_id,source_inquiry_id,
      starts_at,ends_at,mode,status,student_completed_at,teacher_completed_at,note)
    select new.teacher_id,new.student_id,new.id,new.id,new.requested_start_at,new.requested_end_at,new.lesson_mode,
      case when new.lesson_status in ('completed','cancelled','no_show_reported') then new.lesson_status
        when new.requested_start_at is not null and new.requested_end_at is not null then 'scheduled' else 'needs_scheduling' end,
      new.student_completed_at,new.teacher_completed_at,new.lesson_note
    where not exists(select 1 from public.lessons where source_inquiry_id=new.id);
  end if;
  return new;
end;
$$;
create trigger accepted_inquiry_lesson after insert or update of status on public.inquiries
for each row execute function public.create_accepted_inquiry_lesson();

create function public.mirror_source_lesson() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.source_inquiry_id is not null then
    update public.inquiries set requested_start_at=new.starts_at,requested_end_at=new.ends_at,lesson_mode=new.mode,
      lesson_status=case when new.status='scheduled' then 'awaiting' else new.status end,
      student_completed_at=new.student_completed_at,teacher_completed_at=new.teacher_completed_at,
      lesson_note=new.note,lesson_updated_at=new.updated_at where id=new.source_inquiry_id;
  end if;
  return new;
end;
$$;
create trigger mirror_source_lesson after update on public.lessons
for each row execute function public.mirror_source_lesson();

create function public.notify_lesson_change(p_lesson public.lessons,p_actor uuid,p_action text)
returns void language plpgsql security definer set search_path='' as $$
declare
  teacher_user uuid;
  recipient uuid;
  audience text;
  heading text;
begin
  select user_id into teacher_user from public.teacher_profiles where id=p_lesson.teacher_id;
  recipient:=case when p_actor=teacher_user then p_lesson.student_id else teacher_user end;
  audience:=case when recipient=p_lesson.student_id then 'student' else 'teacher' end;
  heading:=case p_action when 'scheduled' then 'נקבע שיעור חדש' when 'rescheduled' then 'מועד השיעור עודכן'
    when 'cancel' then 'השיעור בוטל' when 'report_no_show' then 'התקבל דיווח על אי-הגעה'
    else case when p_lesson.status='completed' then 'שני המשתתפים אישרו שהשיעור התקיים' else 'הצד השני אישר שהשיעור התקיים' end end;
  insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
  values(recipient,'lesson_updated',heading,coalesce(to_char(p_lesson.starts_at at time zone 'Asia/Jerusalem','DD/MM/YYYY HH24:MI'),'לפרטים ולעדכון פתחו את השיעור'),'lesson',p_lesson.id);
  perform public.enqueue_marketplace_email('lesson.changed',p_lesson.id,recipient,audience,
    jsonb_build_object('action',p_action,'status',p_lesson.status,'start',p_lesson.starts_at,'end',p_lesson.ends_at,
      'mode',p_lesson.mode,'note',p_lesson.note,'confirmedByBoth',p_lesson.status='completed'),
    'lesson:'||p_lesson.id||':'||p_lesson.revision);
end;
$$;

create function public.save_teacher_lesson(p_actor uuid,p_request_key uuid,p_student uuid,
  p_start timestamptz,p_end timestamptz,p_mode text,p_lesson_id uuid default null)
returns setof public.lessons language plpgsql security definer set search_path='' as $$
declare
  teacher uuid;
  connection uuid;
  lesson public.lessons%rowtype;
begin
  select id into teacher from public.teacher_profiles where user_id=p_actor for update;
  if teacher is null then raise exception 'LESSON_CONNECTION_REQUIRED' using errcode='42501'; end if;
  if p_lesson_id is null then
    if p_request_key is null then raise exception 'LESSON_REQUEST_KEY_REQUIRED' using errcode='23514'; end if;
    select * into lesson from public.lessons where teacher_id=teacher and request_key=p_request_key;
    if found then
      if (lesson.student_id,lesson.starts_at,lesson.ends_at,lesson.mode) is distinct from (p_student,p_start,p_end,p_mode) then
        raise exception 'LESSON_REQUEST_KEY_REUSED' using errcode='23514';
      end if;
      return next lesson; return;
    end if;
    select id into connection from public.inquiries where teacher_id=teacher and student_id=p_student
      and status='accepted' order by created_at,id limit 1;
    if connection is null then raise exception 'LESSON_CONNECTION_REQUIRED' using errcode='42501'; end if;
    insert into public.lessons(teacher_id,student_id,connection_inquiry_id,request_key,starts_at,ends_at,mode,status)
    values(teacher,p_student,connection,p_request_key,p_start,p_end,p_mode,'scheduled') returning * into lesson;
    perform public.notify_lesson_change(lesson,p_actor,'scheduled');
  else
    select * into lesson from public.lessons where id=p_lesson_id and teacher_id=teacher for update;
    if not found then raise exception 'Lesson not found' using errcode='P0002'; end if;
    if lesson.student_id<>p_student then raise exception 'LESSON_CONNECTION_IMMUTABLE' using errcode='23514'; end if;
    if (lesson.starts_at,lesson.ends_at,lesson.mode) is not distinct from (p_start,p_end,p_mode) then
      return next lesson; return;
    end if;
    if lesson.status not in ('scheduled','needs_scheduling') or lesson.student_completed_at is not null
      or lesson.teacher_completed_at is not null or lesson.starts_at<=now() then
      raise exception 'LESSON_CANNOT_RESCHEDULE' using errcode='23514';
    end if;
    update public.lessons set starts_at=p_start,ends_at=p_end,mode=p_mode,status='scheduled',
      revision=revision+1,updated_at=now() where id=lesson.id returning * into lesson;
    perform public.notify_lesson_change(lesson,p_actor,'rescheduled');
  end if;
  return next lesson;
end;
$$;

create function public.update_scheduled_lesson_state(p_user_id uuid,p_lesson_id uuid,p_action text,p_note text default '')
returns setof public.lessons language plpgsql security definer set search_path='' as $$
declare
  lesson public.lessons%rowtype;
  teacher_user uuid;
begin
  select l.* into lesson from public.lessons l join public.teacher_profiles t on t.id=l.teacher_id
    where l.id=p_lesson_id and (l.student_id=p_user_id or t.user_id=p_user_id);
  if not found then raise exception 'Lesson not found' using errcode='P0002'; end if;
  select user_id into teacher_user from public.teacher_profiles where id=lesson.teacher_id for update;
  perform 1 from public.profiles where id=lesson.student_id for update;
  select * into lesson from public.lessons where id=p_lesson_id for update;
  if not found then raise exception 'Lesson not found' using errcode='P0002'; end if;
  if p_action='confirm_completed' then
    if lesson.status='completed' then return next lesson; return; end if;
    if lesson.status<>'scheduled' or lesson.ends_at is null or lesson.ends_at>now() then
      raise exception 'LESSON_COMPLETION_NOT_ALLOWED' using errcode='23514';
    end if;
    if (p_user_id=lesson.student_id and lesson.student_completed_at is not null)
      or (p_user_id=teacher_user and lesson.teacher_completed_at is not null) then return next lesson; return; end if;
    update public.lessons set
      student_completed_at=case when p_user_id=student_id then now() else student_completed_at end,
      teacher_completed_at=case when p_user_id=teacher_user then now() else teacher_completed_at end,
      updated_at=now(),revision=revision+1 where id=lesson.id returning * into lesson;
    if lesson.student_completed_at is not null and lesson.teacher_completed_at is not null then
      update public.lessons set status='completed' where id=lesson.id returning * into lesson;
    end if;
  elsif p_action in ('cancel','report_no_show') then
    if length(btrim(coalesce(p_note,'')))<5 or length(p_note)>1000 then
      raise exception 'LESSON_REASON_REQUIRED' using errcode='23514';
    end if;
    if lesson.status=(case when p_action='cancel' then 'cancelled' else 'no_show_reported' end) then return next lesson; return; end if;
    if lesson.status not in ('scheduled','needs_scheduling') then
      raise exception 'LESSON_ALREADY_CLOSED' using errcode='23514';
    end if;
    if p_action='report_no_show' and (lesson.ends_at is null or lesson.ends_at>now()) then
      raise exception 'LESSON_COMPLETION_NOT_ALLOWED' using errcode='23514';
    end if;
    update public.lessons set status=case when p_action='cancel' then 'cancelled' else 'no_show_reported' end,
      note=btrim(p_note),updated_at=now(),revision=revision+1 where id=lesson.id returning * into lesson;
  else raise exception 'LESSON_INVALID_ACTION' using errcode='22023';
  end if;
  perform public.notify_lesson_change(lesson,p_user_id,p_action);
  return next lesson;
end;
$$;

-- Old deep links continue to operate on the same first lesson, not a second lifecycle.
create or replace function public.update_lesson_state(p_user_id uuid,p_inquiry_id uuid,p_action text,p_note text default '')
returns setof public.inquiries language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  select id into target from public.lessons where source_inquiry_id=p_inquiry_id;
  if target is null then raise exception 'Lesson not found' using errcode='P0002'; end if;
  perform public.update_scheduled_lesson_state(p_user_id,target,p_action,p_note);
  return query select * from public.inquiries where id=p_inquiry_id;
end;
$$;

create or replace function public.guard_review_completed_lesson() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.inquiries i join public.lessons l on l.teacher_id=i.teacher_id and l.student_id=i.student_id
    where i.id=new.inquiry_id and i.status='accepted' and i.student_id=new.student_id and i.teacher_id=new.teacher_id and l.status='completed') then
    raise exception 'A review requires a lesson confirmed by both participants' using errcode='23514';
  end if;
  return new;
end;
$$;

alter table public.support_tickets add column lesson_id uuid references public.lessons(id) on delete set null;
create function public.create_lesson_support_ticket(p_user_id uuid,p_request_key uuid,p_category text,p_subject text,p_message text,p_lesson_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare lesson public.lessons%rowtype; result jsonb;
begin
  select l.* into lesson from public.lessons l join public.teacher_profiles t on t.id=l.teacher_id
    where l.id=p_lesson_id and (l.student_id=p_user_id or t.user_id=p_user_id);
  if not found then raise exception 'Lesson not found' using errcode='P0002'; end if;
  if p_category not in ('support','report','bug') then raise exception 'Invalid lesson support category' using errcode='23514'; end if;
  result:=public.create_context_support_ticket(p_user_id,p_request_key,p_category,p_subject,p_message,lesson.teacher_id,lesson.connection_inquiry_id,null);
  if exists(select 1 from public.support_tickets where id=(result->>'id')::uuid and lesson_id is not null and lesson_id<>p_lesson_id) then
    raise exception 'Request key belongs to another lesson' using errcode='23514';
  end if;
  update public.support_tickets set lesson_id=p_lesson_id where id=(result->>'id')::uuid;
  return result||jsonb_build_object('lesson_id',p_lesson_id);
end;
$$;

revoke execute on function public.guard_scheduled_lesson(),public.create_accepted_inquiry_lesson(),public.mirror_source_lesson(),
  public.notify_lesson_change(public.lessons,uuid,text),public.save_teacher_lesson(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid),
  public.update_scheduled_lesson_state(uuid,uuid,text,text),public.create_lesson_support_ticket(uuid,uuid,text,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.save_teacher_lesson(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid),
  public.update_scheduled_lesson_state(uuid,uuid,text,text),public.create_lesson_support_ticket(uuid,uuid,text,text,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
