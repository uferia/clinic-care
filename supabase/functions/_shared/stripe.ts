import Stripe from 'npm:stripe@17';

/**
 * Shared Stripe client. Keys come from the environment — `supabase/.env` locally (loaded via
 * [edge_runtime.secrets] in config.toml) and `supabase secrets set` for deployed functions.
 * Nothing Stripe-related is ever hardcoded, so test and live keys swap without a code change.
 */
export function stripeClient(): Stripe {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  return new Stripe(key, {
    // Deno has no native Node crypto/http; Stripe ships a fetch-based client for exactly this.
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/** The monthly plan every clinic subscribes to. A Stripe Price ID, not an amount. */
export function priceId(): string {
  const price = Deno.env.get('STRIPE_PRICE_ID');
  if (!price) throw new Error('STRIPE_PRICE_ID is not set');
  return price;
}

/** Where Stripe sends the clinic back to after checkout or the billing portal. */
export function appUrl(): string {
  return Deno.env.get('APP_URL') ?? 'http://localhost:4200';
}
