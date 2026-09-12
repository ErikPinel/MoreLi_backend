begin;

create function public.replace_professions(p_professions jsonb)
returns table (
  active_count integer,
  deleted_count integer,
  retained_inactive_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_count integer;
begin
  if jsonb_typeof(p_professions) <> 'array' then
    raise exception 'professions must be an array' using errcode = '22023';
  end if;

  requested_count := jsonb_array_length(p_professions);
  if requested_count < 1 or requested_count > 2000 then
    raise exception 'professions must contain between 1 and 2000 items'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_professions) as item(value)
    where jsonb_typeof(item.value) <> 'string'
      or char_length(btrim(item.value #>> '{}')) not between 1 and 160
  ) then
    raise exception 'professions must be non-empty strings up to 160 characters'
      using errcode = '22023';
  end if;

  if (
    select count(distinct btrim(item.value #>> '{}'))
    from jsonb_array_elements(p_professions) as item(value)
  ) <> requested_count then
    raise exception 'professions must be unique' using errcode = '23514';
  end if;

  lock table public.subjects in share row exclusive mode;

  update public.subjects
  set is_active = false,
      parent_id = null;

  insert into public.subjects (
    parent_id,
    name_he,
    name_en,
    slug,
    sort_order,
    is_active
  )
  select
    null,
    btrim(item.value #>> '{}'),
    btrim(item.value #>> '{}'),
    'profession-' || md5(btrim(item.value #>> '{}')),
    item.ordinality::integer * 10,
    true
  from jsonb_array_elements(p_professions) with ordinality as item(value, ordinality)
  on conflict (slug) do update set
    parent_id = null,
    name_he = excluded.name_he,
    name_en = excluded.name_en,
    sort_order = excluded.sort_order,
    is_active = true;

  delete from public.subjects subject
  where not subject.is_active
    and not exists (
      select 1
      from public.teacher_subjects
      where teacher_subjects.subject_id = subject.id
    )
    and not exists (
      select 1
      from public.student_requests
      where student_requests.subject_id = subject.id
    );
  get diagnostics deleted_count = row_count;

  select count(*)::integer
  into active_count
  from public.subjects
  where is_active;

  select count(*)::integer
  into retained_inactive_count
  from public.subjects
  where not is_active;

  return next;
end;
$$;

revoke all on function public.replace_professions(jsonb) from public;
revoke all on function public.replace_professions(jsonb) from anon;
revoke all on function public.replace_professions(jsonb) from authenticated;
grant execute on function public.replace_professions(jsonb) to service_role;

commit;