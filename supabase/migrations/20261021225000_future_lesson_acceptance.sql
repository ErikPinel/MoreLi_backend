begin;
create function public.guard_future_lesson_acceptance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status='accepted' and old.status is distinct from 'accepted'
    and new.requested_start_at is not null and new.requested_start_at<=now() then
    raise exception 'The requested lesson start has passed; request a new available time' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger inquiries_future_acceptance before update of status on public.inquiries
for each row execute function public.guard_future_lesson_acceptance();
revoke execute on function public.guard_future_lesson_acceptance() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;