-- Self-serve paid subscriptions via Stripe Checkout (subscription mode).
--
-- Access is still gated by OUR `subscriptions.active_until` — never by a live call to Stripe.
-- Stripe tells us about payments through the webhook; if Stripe is unreachable, clinics keep the
-- access they already paid for rather than being locked out by someone else's outage.
alter table public.subscriptions
  add column stripe_customer_id     text,
  add column stripe_subscription_id text,
  -- Set from Stripe when a clinic cancels: they keep access until active_until, then lapse.
  add column cancel_at_period_end   boolean not null default false;

create index subscriptions_stripe_sub_idx on public.subscriptions (stripe_subscription_id);

-- Remember a clinic's Stripe customer before checkout, so a second checkout does not create a
-- duplicate customer for the same clinic.
create or replace function public.set_stripe_customer(
  p_clinic_id   uuid,
  p_customer_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.subscriptions
     set stripe_customer_id = p_customer_id,
         updated_at         = now()
   where clinic_id = p_clinic_id;
end;
$$;

/*
 * Apply a paid Stripe period to a clinic's access.
 *
 * Trial credit: a clinic converting mid-trial keeps the days it has not used — the paid period is
 * added ON TOP of the remaining trial, so paying on day 3 of 30 is never a punishment. The credit
 * applies only on the first conversion (while still 'trialing'); later renewals simply track
 * Stripe's period end, which is always further out than the access the clinic already holds.
 *
 * Idempotent, and one-directional. Stripe retries deliveries, so both failure modes are real:
 *   - Access is set FROM Stripe's period end, never by adding a month to whatever is there, so a
 *     duplicate delivery cannot grant two months.
 *   - Access never moves BACKWARDS. A replay arrives after the clinic is already 'active', so it
 *     computes no trial credit; without the greatest() below it would rewrite active_until to the
 *     bare period end and silently confiscate the trial days credited on the first delivery.
 */
create or replace function public.apply_stripe_subscription(
  p_clinic_id       uuid,
  p_customer_id     text,
  p_subscription_id text,
  p_period_end      timestamptz
)
returns public.subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.subscriptions;
  v_credit  interval := interval '0';
  v_result  public.subscriptions;
begin
  select * into v_current from public.subscriptions where clinic_id = p_clinic_id;
  if v_current.clinic_id is null then
    raise exception 'clinic not found';
  end if;

  if v_current.status = 'trialing' and v_current.trial_ends_at > now() then
    v_credit := v_current.trial_ends_at - now();
  end if;

  update public.subscriptions
     set status                 = 'active',
         active_until           = greatest(p_period_end + v_credit, coalesce(active_until, p_period_end + v_credit)),
         stripe_customer_id     = coalesce(p_customer_id, stripe_customer_id),
         stripe_subscription_id = coalesce(p_subscription_id, stripe_subscription_id),
         cancel_at_period_end   = false,
         updated_at             = now()
   where clinic_id = p_clinic_id
  returning * into v_result;

  return v_result;
end;
$$;

-- A cancellation does not revoke access: the clinic keeps what it paid for until active_until.
create or replace function public.mark_stripe_cancelled(
  p_subscription_id text,
  p_cancel_at_period_end boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.subscriptions
     set cancel_at_period_end = p_cancel_at_period_end,
         updated_at           = now()
   where stripe_subscription_id = p_subscription_id;
end;
$$;

revoke execute on function public.set_stripe_customer(uuid, text) from public, anon, authenticated;
revoke execute on function public.apply_stripe_subscription(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.mark_stripe_cancelled(text, boolean) from public, anon, authenticated;
grant  execute on function public.set_stripe_customer(uuid, text) to service_role;
grant  execute on function public.apply_stripe_subscription(uuid, text, text, timestamptz) to service_role;
grant  execute on function public.mark_stripe_cancelled(text, boolean) to service_role;
