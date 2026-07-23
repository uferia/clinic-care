// ---------------------------------------------------------------------------------------------
// Step 1 findings (live confirmation attempt, 2026-07-23):
//
// docs.xendit.co is JS-rendered and gave contradictory, unreliable answers across multiple
// fetch attempts (one claimed a distinct snake_case "Payment Session" API of type SUBSCRIPTION
// returning payment_link_url/component_sdk_key; another claimed a different snake_case schema
// for create-recurring-plan; a web search suggested the camelCase shape below). None of these
// could be trusted on their own — this matches the "JS-rendered docs return nothing usable"
// problem flagged in the task brief.
//
// What COULD be confirmed concretely (via the actual xendit-node@7.0.0 source on GitHub, tag
// v7.0.0, not doc-summarization): the installed SDK (`npm:xendit-node@7`, see ../_shared/xendit.ts)
// has NO `Recurring` module at all. `index.ts` at that tag only constructs and exports
// `Customer`, `PaymentRequest`, `Transaction`, `Balance`, `PaymentMethod`, `Refund`, `Payout`,
// `Invoice` on the `Xendit` class — Recurring/Subscriptions is not part of this OpenAPI-generated
// client. The brief's draft (`xendit.Recurring.createPlan(...)`) would throw at runtime
// (`Recurring` is undefined). This IS a confirmed, concrete finding, so the code below has been
// adjusted from the brief's draft: the Recurring plan is created via a direct authenticated
// `fetch` to Xendit's REST endpoint instead of going through the SDK, since the SDK doesn't cover
// it. The `Customer` part of the draft, by contrast, WAS confirmed correct against the SDK docs
// (`createCustomer({ data: { referenceId, individualDetail, email } } )` matches exactly) and is
// unchanged.
//
// CONFIRMED LIVE (2026-07-23, real sandbox calls against POST /recurring/schedules,
// POST /customers, and POST /recurring/plans — not doc-summarization):
//   - The Recurring v2 REST API is snake_case throughout (reference_id, customer_id,
//     recurring_action, schedule_id, immediate_action_type, success_return_url,
//     failure_return_url), NOT the camelCase the brief's draft originally assumed. The SDK's
//     Customer module is a separate case: its JS method takes camelCase params and translates
//     them to this same snake_case wire shape internally, so Customer.createCustomer above is
//     unaffected and stays correct as-is.
//   - The checkout URL does come back as an `actions` array entry with `action: 'AUTH'`, exactly
//     as originally drafted — confirmed against a real plan-creation response.
//   - `reference_id` does pass through unchanged onto the created plan object (readable by the
//     webhook as `plan.reference_id`).
//   - `amount` is a whole-currency-unit number (500 in, 500 back), not a smallest-unit integer.
// ---------------------------------------------------------------------------------------------

import { handleCors, json } from '../_shared/cors.ts';
import { requireMemberManager } from '../_shared/auth.ts';
import { appUrl, planConfig, xenditClient } from '../_shared/xendit.ts';

/**
 * Start a Xendit hosted checkout for the caller's clinic.
 *
 * Only a clinic_admin (or a super-admin) can commit their clinic to a payment, and the clinic is
 * taken from the caller's own membership — never from the request body, so nobody can start a
 * subscription against someone else's clinic.
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

  const { data: clinic } = await gate.admin
    .from('clinics').select('name, email').eq('id', clinicId).maybeSingle();
  const { data: sub } = await gate.admin
    .from('subscriptions').select('xendit_customer_id').eq('clinic_id', clinicId).maybeSingle();

  try {
    const xendit = xenditClient();
    const { scheduleId, amount, currency } = planConfig();

    // Reuse the clinic's customer so repeat checkouts do not fan out into duplicates in Xendit.
    // Customer.createCustomer is confirmed against the real xendit-node@7 SDK docs (unlike
    // Recurring below, which the SDK does not support).
    let customerId = sub?.xendit_customer_id as string | undefined;
    if (!customerId) {
      const customer = await xendit.Customer.createCustomer({
        data: {
          referenceId: clinicId,
          individualDetail: { givenNames: clinic?.name ?? 'Clinic' },
          email: clinic?.email ?? undefined,
        },
      });
      customerId = customer.id;
      await gate.admin.rpc('set_xendit_customer', {
        p_clinic_id: clinicId,
        p_customer_id: customerId,
      });
    }

    // The SDK has no Recurring module (see the file-level comment above), so this calls Xendit's
    // REST API directly. reference_id carries clinic_id through to the webhook — replacing
    // Stripe's metadata/client_reference_id pair — confirmed live, see header comment.
    // xendit-node@7 already defaults `xenditURL` to this same value internally, so this can never
    // actually be undefined — no `?? '...'` fallback needed here.
    const xenditUrl = xendit.opts.xenditURL;
    const res = await fetch(`${xenditUrl}/recurring/plans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(`${xendit.opts.secretKey}:`)}`,
      },
      body: JSON.stringify({
        reference_id: clinicId,
        customer_id: customerId,
        recurring_action: 'PAYMENT',
        currency,
        amount,
        schedule_id: scheduleId,
        immediate_action_type: 'FULL_AMOUNT',
        success_return_url: `${appUrl()}/clinic?checkout=success`,
        failure_return_url: `${appUrl()}/clinic?checkout=cancelled`,
      }),
    });
    // A non-JSON body (a gateway 502, a WAF block page, etc.) must not itself throw here — that
    // would mask the real HTTP status behind a confusing SyntaxError. Parse defensively, then
    // check res.ok using whatever did or didn't come back.
    const plan = await res.json().catch(() => null) as {
      actions?: { action: string; url: string }[];
      message?: string;
    } | null;
    if (!res.ok) {
      throw new Error(plan?.message ?? `Xendit recurring plan creation failed (${res.status})`);
    }

    const url = plan?.actions?.find((a) => a.action === 'AUTH')?.url;
    if (!url) throw new Error('Xendit did not return a checkout URL for this plan');

    return json({ url }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'could not start checkout';
    console.error('create-xendit-session failed:', message);
    return json({ error: message }, 500);
  }
});
