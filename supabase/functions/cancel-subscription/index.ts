// ---------------------------------------------------------------------------------------------
// Step 1 findings (live confirmation attempt, 2026-07-23):
//
// docs.xendit.co/apidocs/update-recurring-plan is JS-rendered and did not return usable content
// to an automated fetch, same as every prior task in this plan. This is a known, already-accepted
// limitation of this environment (see Tasks 3/4's header comments) — not re-litigated here.
//
// What IS newly confirmed, carried over from Tasks 3/4's investigation of the actual
// xendit-node@7.0.0 source (tag v7.0.0, on GitHub): the installed SDK has NO `Recurring` module —
// only `Customer`, `PaymentRequest`, `Transaction`, `Balance`, `PaymentMethod`, `Refund`, `Payout`,
// `Invoice` are constructed on the `Xendit` class. So the brief's draft
// (`xendit.Recurring.editPlan({ id, data: { status: 'INACTIVE' } } )`) would throw at runtime —
// `Recurring` is undefined. This function instead calls Xendit's REST API directly, mirroring the
// exact pattern already used in ../create-xendit-session/index.ts (POST) and
// ../xendit-webhook/index.ts (GET): Basic auth via `xendit.opts.secretKey`, base URL via
// `xendit.opts.xenditURL ?? 'https://api.xendit.co'`.
//
// STILL UNCONFIRMED (genuine, irreducible uncertainty — needs a human with Xendit
// dashboard/sandbox access to verify against a real response before this goes live):
//   - Whether PATCH is genuinely the correct HTTP method for this endpoint (chosen here as the
//     conventional REST verb for a partial update of an existing resource, consistent with
//     "update-recurring-plan" naming — not confirmed against a live response).
//   - Whether `status` is the correct field name and `'INACTIVE'` the correct enum value for
//     deactivating a plan (kept exactly as the brief's original draft specified, just delivered via
//     `fetch` instead of the nonexistent SDK method).
// ---------------------------------------------------------------------------------------------

import { handleCors, json } from '../_shared/cors.ts';
import { requireMemberManager } from '../_shared/auth.ts';
import { xenditClient } from '../_shared/xendit.ts';

/**
 * Cancel the caller's clinic's subscription directly via Xendit's API.
 *
 * No confirmed Xendit equivalent to Stripe's customer billing portal exists, so unlike
 * create-portal-session (which returned a URL to redirect to), this function performs the
 * cancellation itself and returns a plain confirmation. Access is not revoked immediately —
 * mark_xendit_cancelled only records intent; the clinic keeps access until active_until passes.
 */
Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const gate = await requireMemberManager(req);
  if ('error' in gate) return json({ error: gate.error }, gate.status);

  let clinicId = gate.clinicId;
  if (gate.isSuperAdmin) {
    try {
      clinicId = (await req.json()).clinic_id ?? null;
    } catch {
      clinicId = null;
    }
  }
  if (!clinicId) return json({ error: 'clinic_id is required' }, 400);

  const { data: sub } = await gate.admin
    .from('subscriptions').select('xendit_recurring_plan_id').eq('clinic_id', clinicId).maybeSingle();
  const recurringPlanId = sub?.xendit_recurring_plan_id as string | undefined;
  if (!recurringPlanId) return json({ error: 'no billing account yet' }, 409);

  try {
    // The SDK has no Recurring module (see the file-level comment above), so this calls Xendit's
    // REST API directly — same Basic-auth pattern as ../create-xendit-session/index.ts and
    // ../xendit-webhook/index.ts.
    const xendit = xenditClient();
    const xenditUrl = xendit.opts.xenditURL ?? 'https://api.xendit.co';
    const res = await fetch(`${xenditUrl}/recurring/plans/${recurringPlanId}`, {
      // VERIFY: confirm PATCH is the correct HTTP method for this endpoint against a live response.
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(`${xendit.opts.secretKey}:`)}`,
      },
      // VERIFY: confirm `status` is the correct field name and `'INACTIVE'` the correct enum value.
      body: JSON.stringify({ status: 'INACTIVE' }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(
        (body as { message?: string })?.message ?? `Xendit plan update failed (${res.status})`,
      );
    }

    await gate.admin.rpc('mark_xendit_cancelled', {
      p_recurring_plan_id: recurringPlanId,
      p_cancel_at_period_end: true,
    });
    await gate.admin.rpc('log_audit', {
      p_clinic_id: clinicId,
      p_actor: gate.userId,
      p_action: 'subscription.cancel_requested',
      p_details: { source: 'xendit' },
    });
    return json({ cancelled: true }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'could not cancel the subscription';
    console.error('cancel-subscription failed:', message);
    return json({ error: message }, 500);
  }
});
