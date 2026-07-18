-- The `tests` schema is normally created by `supabase test db` before running suite files.
-- Guard here so this file is also safe to run standalone / on setups where it isn't pre-created.
create schema if not exists tests;

-- On Postgres 15+, CREATE SCHEMA no longer grants USAGE to PUBLIC by default (unlike the
-- built-in `public` schema). Tests switch to the `authenticated` role via tests.login_as(),
-- so that role needs USAGE on `tests` to call tests.logout() etc. mid-test.
grant usage on schema tests to authenticated;

-- Impersonate an authenticated user with the given auth uid for RLS evaluation.
create or replace function tests.login_as(uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

-- Drop back to superuser between arrange/act blocks.
create or replace function tests.logout()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', null, true);
end;
$$;

-- `supabase test db` (pg_prove) sweeps every *.sql file under supabase/tests/ as a TAP source,
-- not only *.test.sql as the setup step assumes. Without a plan/finish, prove reports this file
-- as "No plan found in TAP output" and fails the whole suite even though 01_isolation passes.
-- Emit a trivial passing plan so this helper file is itself a valid (green) TAP script.
select plan(1);
select pass('test helpers (tests.login_as / tests.logout) defined');
select * from finish();
