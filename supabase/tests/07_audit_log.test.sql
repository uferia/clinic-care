begin;
select plan(8);

select function_privs_are(
  'public', 'log_audit', array['uuid', 'uuid', 'text', 'text', 'jsonb'],
  'authenticated', array[]::text[],
  'authenticated cannot write audit entries'
);

-- Arrange: two clinics, each with an admin; clinic A also has a staff member.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ea01', 'owner-a@x.com'),
  ('00000000-0000-0000-0000-00000000ea02', 'staff-a@x.com'),
  ('00000000-0000-0000-0000-00000000ea03', 'owner-b@x.com');

-- Registration is itself an audited action.
select lives_ok(
  $$ select public.register_clinic('00000000-0000-0000-0000-00000000ea01'::uuid, 'owner-a@x.com'::citext, 'Clinic A') $$,
  'register_clinic succeeds'
);
select lives_ok(
  $$ select public.register_clinic('00000000-0000-0000-0000-00000000ea03'::uuid, 'owner-b@x.com'::citext, 'Clinic B') $$,
  'second clinic registers'
);

select is(
  (select action from public.audit_log a
     join public.clinics c on c.id = a.clinic_id
    where c.name = 'Clinic A'),
  'clinic.register',
  'registering a clinic is recorded'
);

-- The actor email is denormalised so the trail survives the account.
select is(
  (select actor_email::text from public.audit_log a
     join public.clinics c on c.id = a.clinic_id
    where c.name = 'Clinic A'),
  'owner-a@x.com',
  'the trail names the actor'
);

-- Removing a member is recorded against the clinic that lost them.
insert into public.memberships (id, clinic_id, email, role, user_id)
select '00000000-0000-0000-0000-00000000fb01', c.id, 'staff-a@x.com', 'staff',
       '00000000-0000-0000-0000-00000000ea02'
  from public.clinics c where c.name = 'Clinic A';

select lives_ok(
  $$ select public.manage_member(
       '00000000-0000-0000-0000-00000000ea01'::uuid,
       '00000000-0000-0000-0000-00000000fb01'::uuid, 'remove') $$,
  'member removal succeeds'
);
select is(
  (select count(*)::int from public.audit_log
    where action = 'member.remove' and target = 'staff-a@x.com'),
  1,
  'removing a member is recorded with who was removed'
);

-- A clinic_admin reads only their own clinic's trail.
select tests.login_as('00000000-0000-0000-0000-00000000ea03');
select is(
  (select count(*)::int from public.audit_log a
     join public.clinics c on c.id = a.clinic_id
    where c.name = 'Clinic A'),
  0,
  'one clinic cannot read another clinic''s trail'
);
select tests.logout();

select * from finish();
rollback;
