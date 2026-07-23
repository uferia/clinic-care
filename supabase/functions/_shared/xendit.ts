import { Xendit } from 'npm:xendit-node@7';

/**
 * Shared Xendit client. Keys come from the environment — `supabase/.env` locally (loaded via
 * [edge_runtime.secrets] in config.toml) and `supabase secrets set` for deployed functions.
 * Nothing Xendit-related is ever hardcoded, so test and live keys swap without a code change.
 */
export function xenditClient(): Xendit {
  const key = Deno.env.get('XENDIT_SECRET_KEY');
  if (!key) throw new Error('XENDIT_SECRET_KEY is not set');
  return new Xendit({ secretKey: key });
}

/**
 * The monthly plan every clinic subscribes to. Unlike Stripe's Price object, Xendit's recurring
 * plan does not carry a single referenceable ID that encodes amount + currency + schedule — the
 * amount is a parameter WE supply at plan-creation time. These three env vars are the equivalent
 * of Stripe's Price ID: change them, no deploy needed.
 *   - XENDIT_SCHEDULE_ID: a Schedule object pre-created once in the Xendit dashboard/API
 *     (interval=MONTH + retry rules), referenced by ID.
 *   - XENDIT_PLAN_AMOUNT / XENDIT_PLAN_CURRENCY: the price. Confirm during Task 3 whether Xendit's
 *     recurring Plan amount is a whole-currency-unit number (like its Invoice API) or a smallest-
 *     unit integer (like Stripe's cents) — this is not confirmed from documentation and matters
 *     for correctness (a wrong unit is a 100x pricing bug).
 */
export function planConfig(): { scheduleId: string; amount: number; currency: string } {
  const scheduleId = Deno.env.get('XENDIT_SCHEDULE_ID');
  const amount = Number(Deno.env.get('XENDIT_PLAN_AMOUNT'));
  const currency = Deno.env.get('XENDIT_PLAN_CURRENCY');
  if (!scheduleId) throw new Error('XENDIT_SCHEDULE_ID is not set');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('XENDIT_PLAN_AMOUNT is not set');
  if (!currency) throw new Error('XENDIT_PLAN_CURRENCY is not set');
  return { scheduleId, amount, currency };
}

/** Where Xendit sends the clinic back to after checkout. */
export function appUrl(): string {
  return Deno.env.get('APP_URL') ?? 'http://localhost:4200';
}
