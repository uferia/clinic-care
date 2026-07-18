alter table public.clinics       enable row level security;
alter table public.subscriptions enable row level security;
alter table public.memberships   enable row level security;
alter table public.patients      enable row level security;
alter table public.doctors       enable row level security;
alter table public.appointments  enable row level security;
alter table public.super_admins  enable row level security;

-- Domain tables: own clinic AND subscription live. Same predicate for read and write.
create policy patients_tenant on public.patients
  for all to authenticated
  using (clinic_id = public.current_clinic_id() and public.current_clinic_active())
  with check (clinic_id = public.current_clinic_id() and public.current_clinic_active());

create policy doctors_tenant on public.doctors
  for all to authenticated
  using (clinic_id = public.current_clinic_id() and public.current_clinic_active())
  with check (clinic_id = public.current_clinic_id() and public.current_clinic_active());

create policy appointments_tenant on public.appointments
  for all to authenticated
  using (clinic_id = public.current_clinic_id() and public.current_clinic_active())
  with check (clinic_id = public.current_clinic_id() and public.current_clinic_active());

-- Clinic / subscription / membership: readable by a member of that clinic (NOT gated by active,
-- so a blocked user can still see why). Also readable by super-admins (all rows). No client writes.
create policy clinics_read on public.clinics
  for select to authenticated
  using (id = public.current_clinic_id() or public.is_super_admin());

create policy subscriptions_read on public.subscriptions
  for select to authenticated
  using (clinic_id = public.current_clinic_id() or public.is_super_admin());

create policy memberships_read on public.memberships
  for select to authenticated
  using (clinic_id = public.current_clinic_id() or public.is_super_admin());

-- super_admins: a user may read only their own row (to self-detect super-admin in the UI).
create policy super_admins_read_self on public.super_admins
  for select to authenticated
  using (user_id = auth.uid());
