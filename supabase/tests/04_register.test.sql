begin;
select plan(9);

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

-- Assertions below resolve the clinic through the registrant's OWN membership, not by name.
-- A seeded or leftover clinic that happens to share the name must not decide whether this passes.
create temporary table registered on commit drop as
  select m.clinic_id
    from public.memberships m
   where m.user_id = '00000000-0000-0000-0000-00000000aa01';

select is(
  (select count(*)::int from registered),
  1,
  'the registrant ends up in exactly one clinic'
);

select is(
  (select c.name from public.clinics c join registered r on r.clinic_id = c.id),
  'Sunrise Clinic',
  'clinic created with a trimmed name'
);

-- Trial is 30 days, not the old 14.
select is(
  (select round(extract(epoch from (s.trial_ends_at - now())) / 86400)::int
     from public.subscriptions s join registered r on r.clinic_id = s.clinic_id),
  30,
  'subscription starts trialing for 30 days'
);

select is(
  (select s.status from public.subscriptions s join registered r on r.clinic_id = s.clinic_id),
  'trialing',
  'subscription status is trialing'
);

-- The registrant owns the clinic and is bound immediately (no first-login wait).
select is(
  (select m.role || ':' || (m.user_id is not null)::text
     from public.memberships m join registered r on r.clinic_id = m.clinic_id),
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
