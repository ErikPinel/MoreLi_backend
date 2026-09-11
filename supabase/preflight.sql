select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;

select typname
from pg_type
where typnamespace = 'public'::regnamespace
  and typtype = 'e'
order by typname;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'supabase_migrations'
  and table_name = 'schema_migrations'
order by ordinal_position;