-- Edge functions use the service-role client for privileged checks + writes
-- (see supabase/functions/_shared/auth.ts and create-clinic/index.ts). The
-- service_role Postgres role bypasses RLS but still needs base-table
-- privileges granted explicitly; 0004_grants.sql only covered `authenticated`.

grant select on public.super_admins  to service_role;
grant select, insert on public.clinics       to service_role;
grant select, insert on public.subscriptions to service_role;
