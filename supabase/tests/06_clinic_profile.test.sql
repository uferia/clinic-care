begin;
select plan(7);

select function_privs_are(
  'public', 'update_clinic_profile', array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'text'],
  'authenticated', array[]::text[],
  'authenticated cannot execute update_clinic_profile'
);

insert into public.clinics (id, name) values
  ('00000000-0000-0000-0000-0000000000d1', 'Old Name'),
  ('00000000-0000-0000-0000-0000000000d2', 'Other Clinic');
insert into public.subscriptions (clinic_id, status, trial_ends_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'trialing', now() + interval '30 days'),
  ('00000000-0000-0000-0000-0000000000d2', 'trialing', now() + interval '30 days');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000da01', 'admin-d@x.com'),
  ('00000000-0000-0000-0000-00000000da02', 'staff-d@x.com'),
  ('00000000-0000-0000-0000-00000000da03', 'admin-other@x.com');
insert into public.memberships (clinic_id, email, role, user_id) values
  ('00000000-0000-0000-0000-0000000000d1', 'admin-d@x.com',     'clinic_admin', '00000000-0000-0000-0000-00000000da01'),
  ('00000000-0000-0000-0000-0000000000d1', 'staff-d@x.com',     'staff',        '00000000-0000-0000-0000-00000000da02'),
  ('00000000-0000-0000-0000-0000000000d2', 'admin-other@x.com', 'clinic_admin', '00000000-0000-0000-0000-00000000da03');

-- A clinic_admin renames their own clinic and fills in the letterhead.
select lives_ok(
  $$ select public.update_clinic_profile(
       '00000000-0000-0000-0000-00000000da01'::uuid,
       '00000000-0000-0000-0000-0000000000d1'::uuid,
       '  Sunrise Family Clinic  ', '12 Mabini St', '+63 900 000 0000', 'hello@sunrise.test', 'TIN-123') $$,
  'clinic_admin can update their own clinic profile'
);
select results_eq(
  $$ select name, address, phone, email, tax_id from public.clinics
      where id = '00000000-0000-0000-0000-0000000000d1' $$,
  $$ values ('Sunrise Family Clinic', '12 Mabini St', '+63 900 000 0000', 'hello@sunrise.test', 'TIN-123') $$,
  'name is trimmed and the letterhead fields are stored'
);

-- Blank optional fields are stored as NULL, so the letterhead renders nothing rather than an empty line.
select lives_ok(
  $$ select public.update_clinic_profile(
       '00000000-0000-0000-0000-00000000da01'::uuid,
       '00000000-0000-0000-0000-0000000000d1'::uuid,
       'Sunrise Family Clinic', '   ', '', null, null) $$,
  'blank optional fields are accepted'
);
select is(
  (select address is null and phone is null and tax_id is null
     from public.clinics where id = '00000000-0000-0000-0000-0000000000d1'),
  true,
  'blank optional fields are stored as null'
);

-- Staff cannot rename the clinic, and one clinic cannot rewrite another.
select throws_ok(
  $$ select public.update_clinic_profile(
       '00000000-0000-0000-0000-00000000da02'::uuid,
       '00000000-0000-0000-0000-0000000000d1'::uuid,
       'Staff Rename', null, null, null, null) $$,
  'forbidden',
  'staff cannot edit the clinic profile'
);
select throws_ok(
  $$ select public.update_clinic_profile(
       '00000000-0000-0000-0000-00000000da03'::uuid,
       '00000000-0000-0000-0000-0000000000d1'::uuid,
       'Hostile Rename', null, null, null, null) $$,
  'forbidden',
  'a clinic_admin cannot edit another clinic''s profile'
);

select * from finish();
rollback;
