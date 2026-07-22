begin;
select plan(8);

-- The RPC is reachable only through the edge function's service-role client.
select function_privs_are(
  'public', 'register_clinic', array['uuid', 'citext', 'text'],
  'authenticated', array[]::text[],
  'authenticated cannot execute register_clinic'
);

-- Arrange: an auth user with no membership anywhere.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000aa01', 'owner@newclinic.com');

-- Act: self-service registration (as the edge function calls it, service-role side).
select lives_ok(
  $$ select public.register_clinic(
       '00000000-0000-0000-0000-00000000aa01'::uuid, 'owner@newclinic.com'::citext, '  Sunrise Clinic  ') $$,
  'register_clinic succeeds for an unaffiliated user'
);

select is(
  (select count(*)::int from public.clinics where name = 'Sunrise Clinic'),
  1,
  'clinic created with a trimmed name'
);

-- Trial is 30 days, not the old 14.
select is(
  (select round(extract(epoch from (s.trial_ends_at - now())) / 86400)::int
     from public.subscriptions s
     join public.clinics c on c.id = s.clinic_id
    where c.name = 'Sunrise Clinic'),
  30,
  'subscription starts trialing for 30 days'
);

select is(
  (select s.status from public.subscriptions s
     join public.clinics c on c.id = s.clinic_id
    where c.name = 'Sunrise Clinic'),
  'trialing',
  'subscription status is trialing'
);

-- The registrant owns the clinic and is bound immediately (no first-login wait).
select is(
  (select m.role || ':' || (m.user_id is not null)::text
     from public.memberships m
     join public.clinics c on c.id = m.clinic_id
    where c.name = 'Sunrise Clinic'),
  'clinic_admin:true',
  'registrant becomes a bound clinic_admin'
);

-- A second registration by the same person is refused...
select throws_ok(
  $$ select public.register_clinic(
       '00000000-0000-0000-0000-00000000aa01'::uuid, 'owner@newclinic.com'::citext, 'Second Clinic') $$,
  'already a member',
  'a second clinic for the same account is refused'
);

-- ...and leaves no orphan clinic behind (the whole function is one transaction).
select is(
  (select count(*)::int from public.clinics where name = 'Second Clinic'),
  0,
  'refused registration leaves no orphan clinic'
);

select * from finish();
rollback;
