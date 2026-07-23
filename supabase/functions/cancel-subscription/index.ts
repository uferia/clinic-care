// ---------------------------------------------------------------------------------------------
// Step 1 findings (live confirmation attempt, 2026-07-23):
//
// docs.xendit.co/apidocs/update-recurring-plan is JS-rendered and did not return usable content
// to an automated fetch, same as every prior task in this plan. What replaced it: a real
// sandbox test session against a live test-mode account, walking the actual API by hand.
//
// CONFIRMED (real sandbox calls, 2026-07-23): the installed SDK has NO `Recurring` module (see
// Tasks 3/4's header comments for the source-level confirmation), so this calls Xendit's REST
// API directly, same as those functions. The brief's original guess — `PATCH
// /recurring/plans/{id}` with body `{ status: 'INACTIVE' }` — was tested directly against a
// live plan and disproven: PATCH accepted arbitrary fields (`status`, `recurring_action`,
// `amount`) without a schema error, but silently changed nothing (the response's `updated`
// timestamp never moved). A plain `DELETE` on that same path returned 405. The real endpoint is
// a dedicated action route: `POST /recurring/plans/{id}/deactivate`, no request body — a live
// test confirmed the plan's `status` field flips to `"INACTIVE"` and `updated` advances.
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
    // ../xendit-webhook/index.ts. Confirmed live: this is a dedicated action endpoint, not a
    // field update — no request body.
    const xendit = xenditClient();
    // xendit-node@7 already defaults `xenditURL` to this same value internally, so this can never
    // actually be undefined — no `?? '...'` fallback needed here.
    const xenditUrl = xendit.opts.xenditURL;
    const res = await fetch(`${xenditUrl}/recurring/plans/${recurringPlanId}/deactivate`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${xendit.opts.secretKey}:`)}` },
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
