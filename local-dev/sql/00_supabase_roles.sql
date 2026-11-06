-- The parts of a Supabase database the migrations expect: API roles and the `extensions` schema.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;   -- what SUPABASE_SERVICE_ROLE_KEY maps to; skips RLS like on Supabase

create schema if not exists extensions;
grant usage on schema public, extensions to anon, authenticated, service_role;

-- Everything the migrations create from here on is usable by service_role.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
