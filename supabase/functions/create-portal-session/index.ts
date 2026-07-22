import { handleCors, json } from '../_shared/cors.ts';
import { requireMemberManager } from '../_shared/auth.ts';
import { appUrl, stripeClient } from '../_shared/stripe.ts';

/**
 * Open Stripe's billing portal so a clinic can update its card, see invoices, or cancel — without
 * us building any of that, and without card details ever touching this app.
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
    .from('subscriptions').select('stripe_customer_id').eq('clinic_id', clinicId).maybeSingle();
  const customerId = sub?.stripe_customer_id as string | undefined;
  if (!customerId) return json({ error: 'no billing account yet' }, 409);

  try {
    const session = await stripeClient().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl()}/clinic`,
    });
    return json({ url: session.url }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'could not open the billing portal';
    console.error('create-portal-session failed:', message);
    return json({ error: message }, 500);
  }
});
