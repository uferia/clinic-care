begin;
select plan(4);

-- Arrange: two clinics, each with a member (fake auth users) and one patient.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@x.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@x.com');

insert into public.clinics (id, name) values
  ('00000000-0000-0000-0000-0000000000c1', 'Clinic A'),
  ('00000000-0000-0000-0000-0000000000c2', 'Clinic B');

insert into public.subscriptions (clinic_id, status, trial_ends_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'trialing', now() + interval '14 days'),
  ('00000000-0000-0000-0000-0000000000c2', 'trialing', now() + interval '14 days');

insert into public.memberships (clinic_id, email, role, user_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'a@x.com', 'staff', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000c2', 'b@x.com', 'staff', '00000000-0000-0000-0000-0000000000b1');

-- Patients are seeded as the postgres superuser (no auth.uid() yet), but the
-- set_clinic_id_patients BEFORE INSERT trigger (Task 3) overwrites clinic_id with
-- current_clinic_id(), which is null outside of an authenticated session and would raise
-- "no clinic for current user". Disable the trigger for this arrange-only seed so the
-- explicit clinic_id values above take effect, matching the same pattern used by the
-- Task 7 gating test for the same reason.
alter table public.patients disable trigger set_clinic_id_patients;
insert into public.patients (clinic_id, first_name, last_name) values
  ('00000000-0000-0000-0000-0000000000c1', 'Alice', 'A'),
  ('00000000-0000-0000-0000-0000000000c2', 'Bob', 'B');
alter table public.patients enable trigger set_clinic_id_patients;

-- Act + assert: user A sees only clinic A's patient.
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select is(
  (select count(*)::int from public.patients),
  1,
  'user A sees exactly one patient (own clinic)'
);
select is(
  (select first_name from public.patients),
  'Alice',
  'user A sees Alice, not Bob'
);

-- User B sees only clinic B's patient.
select tests.logout();
select tests.login_as('00000000-0000-0000-0000-0000000000b1');
select is(
  (select count(*)::int from public.patients),
  1,
  'user B sees exactly one patient (own clinic)'
);
select is(
  (select first_name from public.patients),
  'Bob',
  'user B sees Bob, not Alice'
);

select tests.logout();
select * from finish();
rollback;
