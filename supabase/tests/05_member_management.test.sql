begin;
select plan(9);

-- The RPC is reachable only through the edge function's service-role client.
select function_privs_are(
  'public', 'manage_member', array['uuid', 'uuid', 'text', 'text'],
  'authenticated', array[]::text[],
  'authenticated cannot execute manage_member'
);

-- Arrange: two clinics. Clinic A has an admin, a second admin, and one staff member.
insert into public.clinics (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Clinic A'),
  ('00000000-0000-0000-0000-0000000000b1', 'Clinic B');
insert into public.subscriptions (clinic_id, status, trial_ends_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'trialing', now() + interval '30 days'),
  ('00000000-0000-0000-0000-0000000000b1', 'trialing', now() + interval '30 days');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ba01', 'admin-a@x.com'),
  ('00000000-0000-0000-0000-00000000ba02', 'admin2-a@x.com'),
  ('00000000-0000-0000-0000-00000000ba03', 'staff-a@x.com'),
  ('00000000-0000-0000-0000-00000000ba04', 'admin-b@x.com');

insert into public.memberships (id, clinic_id, email, role, user_id) values
  ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-0000000000a1', 'admin-a@x.com',  'clinic_admin', '00000000-0000-0000-0000-00000000ba01'),
  ('00000000-0000-0000-0000-00000000cc02', '00000000-0000-0000-0000-0000000000a1', 'admin2-a@x.com', 'clinic_admin', '00000000-0000-0000-0000-00000000ba02'),
  ('00000000-0000-0000-0000-00000000cc03', '00000000-0000-0000-0000-0000000000a1', 'staff-a@x.com',  'staff',        '00000000-0000-0000-0000-00000000ba03'),
  ('00000000-0000-0000-0000-00000000cc04', '00000000-0000-0000-0000-0000000000b1', 'admin-b@x.com',  'clinic_admin', '00000000-0000-0000-0000-00000000ba04');

-- A clinic_admin promotes their own staff member.
select lives_ok(
  $$ select public.manage_member(
       '00000000-0000-0000-0000-00000000ba01'::uuid,
       '00000000-0000-0000-0000-00000000cc03'::uuid, 'set_role', 'clinic_admin') $$,
  'clinic_admin can promote a member of their own clinic'
);
select is(
  (select role from public.memberships where id = '00000000-0000-0000-0000-00000000cc03'),
  'clinic_admin',
  'role change persisted'
);

-- Staff cannot manage anyone (demote them back first).
update public.memberships set role = 'staff' where id = '00000000-0000-0000-0000-00000000cc03';
select throws_ok(
  $$ select public.manage_member(
       '00000000-0000-0000-0000-00000000ba03'::uuid,
       '00000000-0000-0000-0000-00000000cc02'::uuid, 'remove') $$,
  'forbidden',
  'a staff member cannot manage members'
);

-- An admin of clinic B cannot touch clinic A's members.
select throws_ok(
  $$ select public.manage_member(
       '00000000-0000-0000-0000-00000000ba04'::uuid,
       '00000000-0000-0000-0000-00000000cc03'::uuid, 'remove') $$,
  'forbidden',
  'a clinic_admin cannot manage another clinic''s members'
);

-- Removal revokes access: the row is gone, so current_clinic_id() no longer resolves.
select lives_ok(
  $$ select public.manage_member(
       '00000000-0000-0000-0000-00000000ba01'::uuid,
       '00000000-0000-0000-0000-00000000cc03'::uuid, 'remove') $$,
  'clinic_admin can remove a member of their own clinic'
);
select tests.login_as('00000000-0000-0000-0000-00000000ba03');
select is(
  (select public.current_clinic_id()),
  null,
  'a removed member resolves to no clinic'
);
select tests.logout();

-- The last admin can be neither demoted nor removed.
select lives_ok(
  $$ select public.manage_member(
       '00000000-0000-0000-0000-00000000ba01'::uuid,
       '00000000-0000-0000-0000-00000000cc02'::uuid, 'remove') $$,
  'one of two admins can be removed'
);
select throws_ok(
  $$ select public.manage_member(
       '00000000-0000-0000-0000-00000000ba01'::uuid,
       '00000000-0000-0000-0000-00000000cc01'::uuid, 'set_role', 'staff') $$,
  'last admin',
  'the last clinic_admin cannot be demoted'
);

select * from finish();
rollback;
