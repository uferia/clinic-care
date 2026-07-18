-- Base-table privileges for the authenticated role. RLS policies (0003) still
-- restrict WHICH rows are visible/writable; these GRANTs are the prerequisite
-- table-level gate Postgres checks before RLS. anon gets nothing (all app
-- access requires login).

grant usage on schema public to authenticated;

-- Domain tables: full CRUD, rows scoped by RLS + subscription gating.
grant select, insert, update, delete on public.patients     to authenticated;
grant select, insert, update, delete on public.doctors      to authenticated;
grant select, insert, update, delete on public.appointments to authenticated;

-- Tenant metadata: client reads only; writes happen via service role later.
grant select on public.clinics       to authenticated;
grant select on public.subscriptions to authenticated;
grant select on public.memberships   to authenticated;
grant select on public.super_admins  to authenticated;

-- Future tables created in public inherit the same baseline for authenticated.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
