import { handleCors, json } from '../_shared/cors.ts';
import { requireMemberManager } from '../_shared/auth.ts';
import { appUrl, priceId, stripeClient } from '../_shared/stripe.ts';

/**
 * Start a Stripe Checkout session for the caller's clinic.
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
    .from('subscriptions').select('stripe_customer_id').eq('clinic_id', clinicId).maybeSingle();

  try {
    const stripe = stripeClient();

    // Reuse the clinic's customer so repeat checkouts do not fan out into duplicates in Stripe.
    let customerId = sub?.stripe_customer_id as string | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: clinic?.name ?? undefined,
        email: clinic?.email ?? undefined,
        metadata: { clinic_id: clinicId },
      });
      customerId = customer.id;
      await gate.admin.rpc('set_stripe_customer', {
        p_clinic_id: clinicId,
        p_customer_id: customerId,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId(), quantity: 1 }],
      // clinic_id travels on the session AND the subscription, so the webhook can resolve the
      // clinic from either object without a lookup table.
      client_reference_id: clinicId,
      metadata: { clinic_id: clinicId },
      subscription_data: { metadata: { clinic_id: clinicId } },
      success_url: `${appUrl()}/clinic?checkout=success`,
      cancel_url: `${appUrl()}/clinic?checkout=cancelled`,
    });

    return json({ url: session.url }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'could not start checkout';
    console.error('create-checkout-session failed:', message);
    return json({ error: message }, 500);
  }
});
