begin;

drop function if exists public.publish_teacher(uuid, uuid);

notify pgrst, 'reload schema';
commit;