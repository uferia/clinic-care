begin;
select plan(3);

-- Arrange: a seeded membership with no bound user yet.
insert into public.clinics (id, name) values
  ('00000000-0000-0000-0000-0000000000f1', 'Bind Clinic');
insert into public.subscriptions (clinic_id, status, trial_ends_at) values
  ('00000000-0000-0000-0000-0000000000f1', 'trialing', now() + interval '14 days');
insert into public.memberships (clinic_id, email, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'new@x.com', 'staff');

-- Precondition: membership is unbound.
select is(
  (select user_id from public.memberships where email = 'new@x.com'),
  null,
  'membership starts unbound'
);

-- Act: the person logs in for the first time (auth user is created).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ff01', 'new@x.com');

-- Assert: the trigger bound the membership to the new user_id.
select is(
  (select user_id from public.memberships where email = 'new@x.com'),
  '00000000-0000-0000-0000-00000000ff01'::uuid,
  'membership binds to new auth user by email'
);

-- And current_clinic_id resolves for that user.
select tests.login_as('00000000-0000-0000-0000-00000000ff01');
select is(
  (select public.current_clinic_id()),
  '00000000-0000-0000-0000-0000000000f1'::uuid,
  'current_clinic_id resolves after binding'
);
select tests.logout();

select * from finish();
rollback;
