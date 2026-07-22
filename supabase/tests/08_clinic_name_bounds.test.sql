begin;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000fa01', 'short@x.com'),
  ('00000000-0000-0000-0000-00000000fa02', 'long@x.com'),
  ('00000000-0000-0000-0000-00000000fa03', 'ok@x.com'),
  ('00000000-0000-0000-0000-00000000fa04', 'edge@x.com');

-- A single stray keystroke must not create a permanent clinic.
select throws_ok(
  $$ select public.register_clinic('00000000-0000-0000-0000-00000000fa01'::uuid, 'short@x.com'::citext, 'X') $$,
  'name too short',
  'a one-character clinic name is refused'
);

-- Padding cannot buy length: the trimmed value is what counts.
select throws_ok(
  $$ select public.register_clinic('00000000-0000-0000-0000-00000000fa01'::uuid, 'short@x.com'::citext, '   X   ') $$,
  'name too short',
  'whitespace padding does not satisfy the minimum'
);

select throws_ok(
  format(
    $$ select public.register_clinic('00000000-0000-0000-0000-00000000fa02'::uuid, 'long@x.com'::citext, %L) $$,
    repeat('A', 101)
  ),
  'name too long',
  'a 101-character clinic name is refused'
);

-- A refused registration leaves nothing behind.
select is(
  (select count(*)::int from public.memberships where email in ('short@x.com', 'long@x.com')),
  0,
  'a refused registration creates no membership'
);

-- Two characters is legitimate — clinics do trade under initials.
select lives_ok(
  $$ select public.register_clinic('00000000-0000-0000-0000-00000000fa03'::uuid, 'ok@x.com'::citext, 'AB') $$,
  'a two-character clinic name is accepted'
);

select lives_ok(
  format(
    $$ select public.register_clinic('00000000-0000-0000-0000-00000000fa04'::uuid, 'edge@x.com'::citext, %L) $$,
    repeat('B', 100)
  ),
  'a 100-character clinic name is accepted'
);

-- Renaming is bounded by the same rule as creating.
select throws_ok(
  $$ select public.update_clinic_profile(
       '00000000-0000-0000-0000-00000000fa03'::uuid,
       (select clinic_id from public.memberships where email = 'ok@x.com'),
       'Z', null, null, null, null) $$,
  'name too short',
  'a clinic cannot rename itself below the minimum'
);

-- The table constraint holds even for a writer that bypasses the functions.
-- Two args: SQL and SQLSTATE. A third argument would be read as the expected error MESSAGE,
-- which is Postgres wording we should not pin a test to.
select throws_ok(
  $$ insert into public.clinics (name) values ('Q') $$,
  '23514'
);

select * from finish();
rollback;
