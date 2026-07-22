import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';
import { stripeClient } from '../_shared/stripe.ts';

/**
 * Stripe -> ClinicCare. This is the ONLY thing that grants paid access.
 *
 * Unauthenticated by design (Stripe holds no user JWT), so config.toml sets verify_jwt = false for
 * this function. The signature check below is what makes that safe: an unsigned or wrongly signed
 * body is rejected before it can touch the database. Never weaken it.
 */

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

/** Stripe sends period ends as UNIX seconds. */
function toIso(seconds: number | null | undefined): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

async function clinicIdFor(
  stripe: Stripe,
  subscriptionId: string,
): Promise<{ clinicId: string | null; customerId: string | null; periodEnd: string | null }> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  return {
    clinicId: (sub.metadata?.clinic_id as string) ?? null,
    customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
    periodEnd: toIso((sub as unknown as { current_period_end?: number }).current_period_end),
  };
}

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!signature || !secret) return new Response('missing signature', { status: 400 });

  const body = await req.text();

  let event: Stripe.Event;
  let stripe: Stripe;
  try {
    stripe = stripeClient();
    // Async variant: the sync one needs Node crypto, which Deno does not provide.
    event = await stripe.webhooks.constructEventAsync(body, signature, secret);
  } catch (e) {
    // A bad signature is the one case we must never process. Answer 400 so Stripe stops retrying.
    console.error('stripe-webhook signature check failed:', e instanceof Error ? e.message : e);
    return new Response('invalid signature', { status: 400 });
  }

  const admin = serviceClient();

  try {
    switch (event.type) {
      // First payment: the clinic just finished checkout.
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const subscriptionId = typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id;
        const clinicId = (session.metadata?.clinic_id as string)
          ?? session.client_reference_id
          ?? null;
        if (!subscriptionId || !clinicId) break;

        const { periodEnd, customerId } = await clinicIdFor(stripe, subscriptionId);
        await admin.rpc('apply_stripe_subscription', {
          p_clinic_id: clinicId,
          p_customer_id: customerId,
          p_subscription_id: subscriptionId,
          p_period_end: periodEnd,
        });
        await admin.rpc('log_audit', {
          p_clinic_id: clinicId,
          p_actor: null,
          p_action: 'subscription.paid',
          p_target: periodEnd,
          p_details: { source: 'stripe', event: event.type },
        });
        break;
      }

      // Every later cycle. Stripe charges on its own; access follows the paid period.
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = typeof (invoice as any).subscription === 'string'
          ? (invoice as any).subscription as string
          : (invoice as any).subscription?.id as string | undefined;
        if (!subscriptionId) break;

        const { clinicId, customerId, periodEnd } = await clinicIdFor(stripe, subscriptionId);
        if (!clinicId) break;

        await admin.rpc('apply_stripe_subscription', {
          p_clinic_id: clinicId,
          p_customer_id: customerId,
          p_subscription_id: subscriptionId,
          p_period_end: periodEnd,
        });
        await admin.rpc('log_audit', {
          p_clinic_id: clinicId,
          p_actor: null,
          p_action: 'subscription.renewed',
          p_target: periodEnd,
          p_details: { source: 'stripe', event: event.type },
        });
        break;
      }

      // Cancelled, or scheduled to cancel. Access is NOT revoked here — the clinic keeps what it
      // has paid for until active_until passes, and the existing gate lapses it then.
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await admin.rpc('mark_stripe_cancelled', {
          p_subscription_id: sub.id,
          p_cancel_at_period_end: event.type === 'customer.subscription.deleted'
            ? true
            : sub.cancel_at_period_end === true,
        });
        const clinicId = (sub.metadata?.clinic_id as string) ?? null;
        if (clinicId && event.type === 'customer.subscription.deleted') {
          await admin.rpc('log_audit', {
            p_clinic_id: clinicId,
            p_actor: null,
            p_action: 'subscription.cancelled',
            p_details: { source: 'stripe', event: event.type },
          });
        }
        break;
      }

      // Recorded, but access is untouched: a failed renewal should not evict a clinic mid-day.
      // Stripe retries on its own schedule, and access lapses naturally if it never succeeds.
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = typeof (invoice as any).subscription === 'string'
          ? (invoice as any).subscription as string
          : (invoice as any).subscription?.id as string | undefined;
        if (!subscriptionId) break;
        const { clinicId } = await clinicIdFor(stripe, subscriptionId);
        if (!clinicId) break;
        await admin.rpc('log_audit', {
          p_clinic_id: clinicId,
          p_actor: null,
          p_action: 'subscription.payment_failed',
          p_details: { source: 'stripe', event: event.type },
        });
        break;
      }
    }
  } catch (e) {
    // 500 makes Stripe retry, which is what we want for a transient database failure. The RPCs are
    // idempotent, so a replay cannot double-grant access.
    console.error('stripe-webhook handler failed:', e instanceof Error ? e.message : e);
    return new Response('handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
