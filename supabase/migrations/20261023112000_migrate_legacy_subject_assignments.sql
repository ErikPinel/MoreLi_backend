begin;

create temporary table legacy_subject_names (
  legacy_slug text primary key,
  current_name text not null
) on commit drop;

insert into legacy_subject_names(legacy_slug, current_name) values
  ('mathematics', 'מתמטיקה - הכל'),
  ('english', 'אנגלית - הכל'),
  ('hebrew', 'עברית - הכל'),
  ('physics', 'פיסיקה - הכל'),
  ('chemistry', 'כימיה - הכל'),
  ('biology', 'ביולוגיה - הכל'),
  ('computer-science', 'מדעי המחשב תכנות - הכל'),
  ('mathematics-bagrut', 'מתמטיקה - הכל'),
  ('mathematics-middle-school', 'מתמטיקה - חטיבת ביניים'),
  ('mathematics-bagrut-3', 'מתמטיקה - 3 יח"ל'),
  ('mathematics-bagrut-4', 'מתמטיקה - 4 יח"ל'),
  ('mathematics-bagrut-5', 'מתמטיקה - 5 יח"ל');

do $$
begin
  if exists (
    select 1 from pg_temp.legacy_subject_names mapping
    join public.subjects legacy on legacy.slug = mapping.legacy_slug and not legacy.is_active
    where (
      exists (select 1 from public.teacher_subjects where subject_id = legacy.id)
      or exists (select 1 from public.student_requests where subject_id = legacy.id)
    ) and not exists (
      select 1 from public.subjects current where current.name_he = mapping.current_name and current.is_active
    )
  ) then
    raise exception 'An active replacement for a referenced legacy subject is missing' using errcode = '23514';
  end if;
end;
$$;

create temporary table legacy_subject_mapping on commit drop as
select legacy.id as old_id, current.id as new_id
from pg_temp.legacy_subject_names mapping
join public.subjects legacy on legacy.slug = mapping.legacy_slug and not legacy.is_active
join public.subjects current on current.name_he = mapping.current_name and current.is_active;

-- Merge rather than overwrite teachers who already selected the current subject.
insert into public.teacher_subjects as current_assignment(teacher_id, subject_id, experience_years, description)
select assignment.teacher_id, mapping.new_id, max(assignment.experience_years),
  string_agg(distinct assignment.description, E'\n' order by assignment.description)
from public.teacher_subjects assignment
join pg_temp.legacy_subject_mapping mapping on mapping.old_id = assignment.subject_id
group by assignment.teacher_id, mapping.new_id
on conflict (teacher_id, subject_id) do update set
  experience_years = greatest(current_assignment.experience_years, excluded.experience_years),
  description = case
    when excluded.description is null or current_assignment.description = excluded.description then current_assignment.description
    when current_assignment.description is null then excluded.description
    else current_assignment.description || E'\n' || excluded.description
  end;

update public.student_requests request set subject_id = mapping.new_id
from pg_temp.legacy_subject_mapping mapping where request.subject_id = mapping.old_id;

delete from public.teacher_subjects assignment
using pg_temp.legacy_subject_mapping mapping where assignment.subject_id = mapping.old_id;

commit;
