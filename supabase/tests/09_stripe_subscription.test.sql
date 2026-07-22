begin;
select plan(10);

select function_privs_are(
  'public', 'apply_stripe_subscription', array['uuid', 'text', 'text', 'timestamptz'],
  'authenticated', array[]::text[],
  'authenticated cannot grant itself a paid subscription'
);
select function_privs_are(
  'public', 'mark_stripe_cancelled', array['text', 'boolean'],
  'authenticated', array[]::text[],
  'authenticated cannot mark a subscription cancelled'
);

-- Arrange: a clinic 10 days into a 30-day trial, so 20 days of credit remain.
insert into public.clinics (id, name) values
  ('00000000-0000-0000-0000-0000000000e1', 'Trial Clinic'),
  ('00000000-0000-0000-0000-0000000000e2', 'Renewing Clinic');
insert into public.subscriptions (clinic_id, status, trial_ends_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'trialing', now() + interval '20 days'),
  ('00000000-0000-0000-0000-0000000000e2', 'trialing', now() + interval '20 days');

-- Converting mid-trial: the paid period is added ON TOP of the unused trial.
select lives_ok(
  $$ select public.apply_stripe_subscription(
       '00000000-0000-0000-0000-0000000000e1'::uuid, 'cus_1', 'sub_1', now() + interval '30 days') $$,
  'a checkout applies to the clinic'
);
select is(
  (select status from public.subscriptions where clinic_id = '00000000-0000-0000-0000-0000000000e1'),
  'active',
  'the clinic becomes active'
);
select is(
  (select round(extract(epoch from (active_until - now())) / 86400)::int
     from public.subscriptions where clinic_id = '00000000-0000-0000-0000-0000000000e1'),
  50,
  'paying on day 10 of a 30-day trial yields 30 paid days PLUS the 20 unused trial days'
);
select is(
  (select stripe_customer_id || '/' || stripe_subscription_id
     from public.subscriptions where clinic_id = '00000000-0000-0000-0000-0000000000e1'),
  'cus_1/sub_1',
  'the Stripe identifiers are recorded'
);

-- Stripe retries webhooks. A duplicate delivery must not extend access a second time.
select public.apply_stripe_subscription(
  '00000000-0000-0000-0000-0000000000e1'::uuid, 'cus_1', 'sub_1', now() + interval '30 days');
select is(
  (select round(extract(epoch from (active_until - now())) / 86400)::int
     from public.subscriptions where clinic_id = '00000000-0000-0000-0000-0000000000e1'),
  50,
  'a replayed webhook does not grant a second period'
);

-- A renewal on an already-active clinic tracks Stripe's period end; no second trial credit.
select public.apply_stripe_subscription(
  '00000000-0000-0000-0000-0000000000e2'::uuid, 'cus_2', 'sub_2', now() + interval '30 days');
select public.apply_stripe_subscription(
  '00000000-0000-0000-0000-0000000000e2'::uuid, 'cus_2', 'sub_2', now() + interval '60 days');
select is(
  (select round(extract(epoch from (active_until - now())) / 86400)::int
     from public.subscriptions where clinic_id = '00000000-0000-0000-0000-0000000000e2'),
  60,
  'renewal follows the new period end without re-crediting the trial'
);

-- Cancelling records intent but does NOT revoke access already paid for.
select public.mark_stripe_cancelled('sub_2', true);
select is(
  (select cancel_at_period_end from public.subscriptions where clinic_id = '00000000-0000-0000-0000-0000000000e2'),
  true,
  'cancellation is recorded'
);
select is(
  (select status from public.subscriptions where clinic_id = '00000000-0000-0000-0000-0000000000e2'),
  'active',
  'a cancelled clinic keeps access until the period it paid for runs out'
);

select * from finish();
rollback;
