-- Окружение, имитирующее Supabase, для прогона миграции на чистом Postgres.
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;

create schema if not exists auth;
drop table if exists auth.users;
create table auth.users (id uuid primary key);

-- Точная копия auth.uid() из Supabase.
create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'),
    ''
  )::uuid
$$;

-- Вход «под пользователем»: set role + JWT claim sub.
create or replace function become(uid uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', uid)::text, false);
$$;

grant usage on schema public to authenticated;
grant usage on schema auth to authenticated;
