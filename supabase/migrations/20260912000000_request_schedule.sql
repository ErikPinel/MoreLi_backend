begin;

alter table public.student_requests
  add column desired_start_at timestamptz;

commit;