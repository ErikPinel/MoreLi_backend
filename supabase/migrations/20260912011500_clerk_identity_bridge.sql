begin;

alter table public.profiles
  drop constraint if exists profiles_id_fkey;

create table public.external_identities (
  provider varchar(32) not null,
  subject varchar(255) not null,
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (provider, subject),
  check (provider = 'clerk'),
  check (char_length(btrim(subject)) > 0)
);

alter table public.external_identities enable row level security;
revoke all on table public.external_identities from public, anon, authenticated;
grant all on table public.external_identities to service_role;

create function public.resolve_external_identity(
  p_provider text,
  p_subject text,
  p_first_name text default '',
  p_last_name text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_profile_id uuid;
begin
  if p_provider <> 'clerk' or btrim(coalesce(p_subject, '')) = '' then
    raise exception 'unsupported external identity' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_provider || ':' || p_subject, 0)
  );

  select profile_id into resolved_profile_id
  from public.external_identities
  where provider = p_provider and subject = p_subject;

  if resolved_profile_id is null then
    resolved_profile_id = gen_random_uuid();

    insert into public.profiles (id, first_name, last_name)
    values (
      resolved_profile_id,
      left(btrim(coalesce(p_first_name, '')), 100),
      left(btrim(coalesce(p_last_name, '')), 100)
    );

    insert into public.external_identities (provider, subject, profile_id)
    values (p_provider, p_subject, resolved_profile_id);
  else
    update public.profiles
    set
      first_name = case
        when btrim(first_name) = '' then left(btrim(coalesce(p_first_name, '')), 100)
        else first_name
      end,
      last_name = case
        when btrim(last_name) = '' then left(btrim(coalesce(p_last_name, '')), 100)
        else last_name
      end
    where id = resolved_profile_id;
  end if;

  return resolved_profile_id;
end;
$$;

revoke all on function public.resolve_external_identity(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_external_identity(text, text, text, text)
  to service_role;

create function public.handle_deleted_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.profiles
  where id = old.id
    and not exists (
      select 1
      from public.external_identities
      where profile_id = old.id
    );
  return old;
end;
$$;

create trigger on_auth_user_deleted
after delete on auth.users
for each row execute function public.handle_deleted_auth_user();

commit;