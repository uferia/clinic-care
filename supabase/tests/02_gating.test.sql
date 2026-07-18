begin;
select plan(4);

-- Arrange: one clinic whose trial has already ended, one member, one patient.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'e@x.com');

insert into public.clinics (id, name) values
  ('00000000-0000-0000-0000-0000000000d1', 'Expired Clinic');

insert into public.subscriptions (clinic_id, status, trial_ends_at, active_until) values
  ('00000000-0000-0000-0000-0000000000d1', 'trialing', now() - interval '1 day', null);

insert into public.memberships (clinic_id, email, role, user_id) values
  ('00000000-0000-0000-0000-0000000000d1', 'e@x.com', 'staff', '00000000-0000-0000-0000-0000000000e1');

-- Patient inserted as superuser (bypasses RLS + clinic_id trigger uses current_clinic_id,
-- which is null here, so set clinic_id explicitly by disabling the trigger for the seed row).
alter table public.patients disable trigger set_clinic_id_patients;
insert into public.patients (clinic_id, first_name, last_name) values
  ('00000000-0000-0000-0000-0000000000d1', 'Ghost', 'G');
alter table public.patients enable trigger set_clinic_id_patients;

select tests.login_as('00000000-0000-0000-0000-0000000000e1');

-- Expired clinic: zero domain rows visible.
select is(
  (select count(*)::int from public.patients),
  0,
  'expired clinic sees zero patients'
);

-- Expired clinic: write is rejected by RLS.
select throws_ok(
  $$ insert into public.patients (first_name, last_name) values ('X', 'Y') $$,
  null,
  'expired clinic cannot insert a patient'
);

-- But the blocked user CAN still read its own subscription (to render the blocked screen).
select is(
  (select status from public.subscriptions),
  'trialing',
  'blocked user can still read its subscription row'
);
select is(
  (select count(*)::int from public.subscriptions),
  1,
  'blocked user reads exactly its own subscription'
);

select tests.logout();
select * from finish();
rollback;
