-- Edge functions use the service-role client for privileged checks + writes
-- (see supabase/functions/_shared/*). The service_role Postgres role bypasses
-- RLS but still needs base-table privileges granted explicitly; 0004_grants.sql
-- only covered `authenticated`. service_role is server-only (the secret key
-- never reaches the browser), so the broad grant below is the standard Supabase
-- model and safe here — it covers all edge functions (create-clinic,
-- add-members, set-subscription, expire-clinic) and any future ones.

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
