-- Xendit replaces Stripe as the subscription payment provider — see
-- docs/superpowers/specs/2026-07-23-xendit-payments-design.md. No clinic has ever paid through the
-- Stripe path (it never went live), so this migration replaces rather than layers alongside it:
-- no backfill, no dual-write period.
alter table public.subscriptions
  drop column stripe_customer_id,
  drop column stripe_subscription_id,
  add column xendit_customer_id       text,
  add column xendit_recurring_plan_id text;

drop index if exists subscriptions_stripe_sub_idx;
create index subscriptions_xendit_plan_idx on public.subscriptions (xendit_recurring_plan_id);

drop function if exists public.set_stripe_customer(uuid, text);
drop function if exists public.apply_stripe_subscription(uuid, text, text, timestamptz);
drop function if exists public.mark_stripe_cancelled(text, boolean);

-- Remember a clinic's Xendit customer before checkout, so a second checkout does not create a
-- duplicate customer for the same clinic.
create or replace function public.set_xendit_customer(
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
     set xendit_customer_id = p_customer_id,
         updated_at         = now()
   where clinic_id = p_clinic_id;
end;
$$;

/*
 * Apply a paid Xendit period to a clinic's access. Same behavior as the Stripe function this
 * replaces (see 0013_stripe_subscriptions.sql in git history for apply_stripe_subscription):
 *
 * Trial credit: a clinic converting mid-trial keeps the days it has not used — the paid period is
 * added ON TOP of the remaining trial, so paying on day 3 of 30 is never a punishment. The credit
 * applies only on the first conversion (while still 'trialing'); later renewals simply track
 * Xendit's period end, which is always further out than the access the clinic already holds.
 *
 * Idempotent, and one-directional. Xendit retries webhook deliveries too, so both failure modes
 * are real:
 *   - Access is set FROM Xendit's period end, never by adding a month to whatever is there, so a
 *     duplicate delivery cannot grant two months.
 *   - Access never moves BACKWARDS. A replay arrives after the clinic is already 'active', so it
 *     computes no trial credit; without the greatest() below it would rewrite active_until to the
 *     bare period end and silently confiscate the trial days credited on the first delivery.
 */
create or replace function public.apply_xendit_subscription(
  p_clinic_id         uuid,
  p_customer_id       text,
  p_recurring_plan_id text,
  p_period_end        timestamptz
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
     set status                   = 'active',
         active_until             = greatest(p_period_end + v_credit, coalesce(active_until, p_period_end + v_credit)),
         xendit_customer_id       = coalesce(p_customer_id, xendit_customer_id),
         xendit_recurring_plan_id = coalesce(p_recurring_plan_id, xendit_recurring_plan_id),
         cancel_at_period_end     = false,
         updated_at               = now()
   where clinic_id = p_clinic_id
  returning * into v_result;

  return v_result;
end;
$$;

-- A cancellation does not revoke access: the clinic keeps what it paid for until active_until.
create or replace function public.mark_xendit_cancelled(
  p_recurring_plan_id text,
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
   where xendit_recurring_plan_id = p_recurring_plan_id;
end;
$$;

revoke execute on function public.set_xendit_customer(uuid, text) from public, anon, authenticated;
revoke execute on function public.apply_xendit_subscription(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.mark_xendit_cancelled(text, boolean) from public, anon, authenticated;
grant  execute on function public.set_xendit_customer(uuid, text) to service_role;
grant  execute on function public.apply_xendit_subscription(uuid, text, text, timestamptz) to service_role;
grant  execute on function public.mark_xendit_cancelled(text, boolean) to service_role;
