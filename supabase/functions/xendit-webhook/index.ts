// ---------------------------------------------------------------------------------------------
// Step 1 findings (live confirmation attempt, 2026-07-23):
//
// No Xendit test-mode dashboard/sandbox credentials are available in this environment, so the
// webhook event names and payload shape could not be confirmed against a live payload as Step 1
// describes (enabling `recurring.plan.activated` / `recurring.plan.inactivated` in the dashboard,
// capturing a real callback body). Proceeding per the task's pre-authorized fallback: best-effort
// draft code from design research, with a `// VERIFY:` comment on every uncertain field access.
// Revisit the moment real credentials exist.
//
// One thing IS newly confirmed here, though, carried over from Task 3's investigation of the
// actual xendit-node@7.0.0 source (tag v7.0.0, on GitHub): the SDK has NO `Recurring` module —
// only `Customer`, `PaymentRequest`, `Transaction`, `Balance`, `PaymentMethod`, `Refund`, `Payout`,
// `Invoice` are constructed on the `Xendit` class. So `xendit.Recurring.getPlan(...)` (as drafted
// in the Task 4 brief) would throw at runtime — `Recurring` is undefined. planDetailsFor below
// calls Xendit's REST API directly instead, mirroring the exact pattern already used for plan
// creation in ../create-xendit-session/index.ts (Basic auth via `xendit.opts.secretKey`).
//
// UPDATE (2026-07-23, real sandbox call against POST /recurring/plans — this GET endpoint
// returns the same plan object shape): `reference_id` and `customer_id` ARE confirmed as the
// real field names on the plan object. `schedule.anchor_date` also genuinely exists at that
// path, but its VALUE is suspect for this purpose — see the VERIFY comment below, which is now
// about semantics rather than field-name existence.
// ---------------------------------------------------------------------------------------------

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { xenditClient } from '../_shared/xendit.ts';

/**
 * Xendit -> ClinicCare. This is the ONLY thing that grants paid access.
 *
 * Unauthenticated by design (Xendit holds no Supabase JWT), so config.toml sets verify_jwt = false
 * for this function. The token check below is what makes that safe: a request whose
 * x-callback-token does not match our stored secret is rejected before it can touch the database.
 * Never weaken it.
 *
 * Unlike Stripe's HMAC-signed payload, Xendit's callback token is a static shared secret — it
 * proves the caller holds the token, not that the payload is untampered. Constant-time compare
 * guards against a timing attack on the comparison itself; it cannot add a replay window Xendit's
 * model doesn't have. What DOES guard against replay: apply_xendit_subscription is idempotent and
 * never moves active_until backwards (see 0014_xendit_subscriptions.sql).
 */

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

/** Constant-time string compare — a plain `===` leaks timing information about where strings diverge. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Retrieve the authoritative plan object by ID rather than trusting the webhook body alone — the
 * same defensive pattern the Stripe webhook used (`stripe.subscriptions.retrieve`).
 *
 * The SDK has no Recurring module (see the file-level comment above), so this calls Xendit's REST
 * API directly — same Basic-auth pattern as the POST in ../create-xendit-session/index.ts. Field
 * paths below are drafted from design research and MUST be confirmed per Step 1 of this task
 * before this is trusted against real money.
 */
async function planDetailsFor(
  recurringPlanId: string,
): Promise<{ clinicId: string | null; customerId: string | null; periodEnd: string | null }> {
  const xendit = xenditClient();
  // xendit-node@7 already defaults `xenditURL` to this same value internally, so this can never
  // actually be undefined — no `?? '...'` fallback needed here.
  const xenditUrl = xendit.opts.xenditURL;
  const res = await fetch(`${xenditUrl}/recurring/plans/${recurringPlanId}`, {
    headers: { Authorization: `Basic ${btoa(`${xendit.opts.secretKey}:`)}` },
  });
  // A non-JSON body (a gateway 502, a WAF block page, etc.) must not itself throw here — that
  // would mask the real HTTP status behind a confusing SyntaxError. Parse defensively, then check
  // res.ok using whatever did or didn't come back.
  const plan = await res.json().catch(() => null) as {
    reference_id?: string;
    customer_id?: string;
    schedule?: { anchor_date?: string };
    message?: string;
  } | null;
  if (!res.ok) {
    throw new Error(plan?.message ?? `Xendit recurring plan lookup failed (${res.status})`);
  }
  return {
    // Confirmed field name via a real POST /recurring/plans response (2026-07-23).
    clinicId: plan?.reference_id ?? null,
    // Confirmed field name via the same real response.
    customerId: plan?.customer_id ?? null,
    // VERIFY: `schedule.anchor_date` exists at this path (confirmed), but its semantics are
    // suspect: a real sandbox schedule-creation call showed anchor_date equal to the SCHEDULE's
    // own creation time, not a per-plan value — and schedules are explicitly reused across
    // clinics/plans (see .env.example), so every plan referencing the same schedule_id would read
    // the identical anchor_date. That cannot be a valid per-clinic period-end. The real field is
    // likely on a per-plan "cycle" resource instead (e.g. GET /recurring/plans/{id}/cycles),
    // unconfirmed because no payment has completed yet in this environment to produce one. Do NOT
    // trust this value against real money until a completed test payment's cycle data is captured
    // and this is replaced with the correct source.
    periodEnd: plan?.schedule?.anchor_date ?? null,
  };
}

Deno.serve(async (req) => {
  const token = req.headers.get('x-callback-token');
  const expected = Deno.env.get('XENDIT_CALLBACK_TOKEN');
  if (!token || !expected || !safeEqual(token, expected)) {
    console.error('xendit-webhook rejected: token mismatch');
    return new Response('invalid token', { status: 400 });
  }

  let event: { event?: string; data?: Record<string, unknown> };
  try {
    event = await req.json();
  } catch {
    return new Response('invalid body', { status: 400 });
  }

  const admin = serviceClient();
  const type = event.event ?? '';
  const data = event.data ?? {};

  try {
    switch (type) {
      // First payment: the clinic just finished checkout and linked GCash.
      case 'recurring.plan.activated': {
        const recurringPlanId = data['id'] as string | undefined;
        if (!recurringPlanId) break;

        const { clinicId, customerId, periodEnd } = await planDetailsFor(recurringPlanId);
        if (!clinicId) break;

        // periodEnd comes from the unconfirmed `schedule?.anchor_date` field above (see the
        // `VERIFY:` comment in planDetailsFor). If it resolves to null, apply_xendit_subscription
        // would set status='active' with active_until left null — the clinic would show as
        // "active" in that column while the access-gate (which reads active_until) treats it as
        // not currently paid, an inconsistent stuck state. Throw instead: this hits the catch
        // below, returns 500, and Xendit retries. The RPC is idempotent, so failing loudly here
        // is safe and preferable to silently creating bad data.
        if (!periodEnd) {
          throw new Error(
            `recurring.plan.activated: periodEnd missing/null for plan ${recurringPlanId} — refusing to apply subscription`,
          );
        }

        await admin.rpc('apply_xendit_subscription', {
          p_clinic_id: clinicId,
          p_customer_id: customerId,
          p_recurring_plan_id: recurringPlanId,
          p_period_end: periodEnd,
        });
        await admin.rpc('log_audit', {
          p_clinic_id: clinicId,
          p_actor: null,
          p_action: 'subscription.paid',
          p_target: periodEnd,
          p_details: { source: 'xendit', event: type },
        });
        break;
      }

      // Cancelled, or scheduled to cancel. Access is NOT revoked here — the clinic keeps what it
      // has paid for until active_until passes, and the existing gate lapses it then.
      case 'recurring.plan.inactivated': {
        const recurringPlanId = data['id'] as string | undefined;
        if (!recurringPlanId) break;

        await admin.rpc('mark_xendit_cancelled', {
          p_recurring_plan_id: recurringPlanId,
          p_cancel_at_period_end: true,
        });

        const { clinicId } = await planDetailsFor(recurringPlanId);
        if (clinicId) {
          await admin.rpc('log_audit', {
            p_clinic_id: clinicId,
            p_actor: null,
            p_action: 'subscription.cancelled',
            p_details: { source: 'xendit', event: type },
          });
        }
        break;
      }

      // VERIFY (Task 4, Step 1): add the confirmed renewal-success event name here once
      // captured from a real sandbox event. Until then, renewals are NOT applied by this
      // function — do not ship to production before this case exists and is tested.

      default:
        console.log('xendit-webhook: unhandled event type', type);
    }
  } catch (e) {
    // 500 makes Xendit retry, which is what we want for a transient database failure. The RPCs
    // are idempotent, so a replay cannot double-grant access.
    console.error('xendit-webhook handler failed:', e instanceof Error ? e.message : e);
    return new Response('handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
