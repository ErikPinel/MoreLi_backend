begin;
alter table public.teacher_profiles add column availability_customized boolean not null default false;
update public.teacher_profiles teacher set availability_customized=true
where exists(select 1 from public.teacher_availability where teacher_id=teacher.id);

create function public.mark_teacher_schedule_customized() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.teacher_profiles set availability_customized=true where id=coalesce(new.teacher_id,old.teacher_id) and not availability_customized;
  return coalesce(new,old);
end;
$$;
create trigger teacher_availability_customized after insert or update or delete on public.teacher_availability
for each row execute function public.mark_teacher_schedule_customized();

create function public.set_teacher_schedule(p_teacher_id uuid,p_slots jsonb)
returns setof public.teacher_availability language plpgsql security definer set search_path = '' as $$
begin
  return query select * from public.replace_teacher_availability(p_teacher_id,p_slots);
  update public.teacher_profiles set availability_customized=true where id=p_teacher_id;
end;
$$;
revoke execute on function public.mark_teacher_schedule_customized() from public,anon,authenticated;
revoke execute on function public.set_teacher_schedule(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.set_teacher_schedule(uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;