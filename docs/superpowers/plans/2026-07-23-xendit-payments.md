# Xendit Payments (replacing Stripe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Stripe subscription integration with Xendit, so clinics can pay by GCash.

**Architecture:** Same shape as the Stripe integration it replaces — a hosted checkout redirect,
a webhook that is the only thing granting paid access, and a cancel action that revokes nothing
immediately. Access is always read from our own `subscriptions.active_until`, never a live
provider call. Trial-credit arithmetic and its `greatest()`-based idempotency guard carry over
unchanged, just re-pointed at renamed functions.

**Tech Stack:** Supabase Postgres + Edge Functions (Deno), `npm:xendit-node@7`, Angular 22 signals,
pgTAP, Vitest.

## Global Constraints

- No clinic has ever paid through the Stripe path — it never went live. This migration **replaces**
  Stripe's columns/functions rather than layering Xendit alongside them. No backfill, no dual-write.
- Access is gated ONLY by `subscriptions.active_until`, checked locally — never by a live call to
  the payment provider at request time.
- `apply_xendit_subscription` must never move `active_until` backwards (the `greatest()` guard) —
  Xendit retries webhook deliveries, same as Stripe did.
- GCash only at launch. Cards/direct debit are out of scope for this plan.
- No self-service payment-method swap. Cancellation is a direct in-app button calling Xendit's API,
  not a hosted portal redirect (none is confirmed to exist).
- `xendit-webhook` runs with `verify_jwt = false` (Xendit holds no Supabase JWT); its safety is the
  `x-callback-token` constant-time compare in the handler, not the auth header.
- Every privileged edge function resolves `clinic_id` from the caller's own membership
  (`requireMemberManager`), never trusts a `clinic_id` in the request body except for a super-admin.
- Two genuine unknowns are NOT resolved by documentation search and are explicit steps in this plan,
  not assumptions: (1) whether Xendit's hosted "Checkout UI" for subscriptions is a distinct
  `payment_session` API or a wrapper over the classic `createPlan` REST call; (2) the exact webhook
  event name and payload field for a successful **renewal** charge (as opposed to first activation).
  Both get a live-documentation/sandbox confirmation step before the code that depends on them is
  treated as done.

---

## Task 1: Database — Xendit columns, renamed RPCs, ported pgTAP tests

**Files:**
- Create: `supabase/migrations/0014_xendit_subscriptions.sql`
- Create: `supabase/tests/09_xendit_subscription.test.sql`
- Delete: `supabase/tests/09_stripe_subscription.test.sql`

**Interfaces:**
- Produces: `public.apply_xendit_subscription(p_clinic_id uuid, p_customer_id text, p_recurring_plan_id text, p_period_end timestamptz) returns public.subscriptions`
- Produces: `public.set_xendit_customer(p_clinic_id uuid, p_customer_id text) returns void`
- Produces: `public.mark_xendit_cancelled(p_recurring_plan_id text, p_cancel_at_period_end boolean) returns void`
- Produces: `subscriptions.xendit_customer_id text`, `subscriptions.xendit_recurring_plan_id text` (replacing the dropped `stripe_customer_id`/`stripe_subscription_id` columns; `cancel_at_period_end` is unchanged)
- Consumes: nothing new — `public.subscriptions`, `public.clinics` already exist from earlier migrations.

- [ ] **Step 1: Write the failing pgTAP test file against the not-yet-existing Xendit functions**

Create `supabase/tests/09_xendit_subscription.test.sql`:

```sql
begin;
select plan(10);

select function_privs_are(
  'public', 'apply_xendit_subscription', array['uuid', 'text', 'text', 'timestamptz'],
  'authenticated', array[]::text[],
  'authenticated cannot grant itself a paid subscription'
);
select function_privs_are(
  'public', 'mark_xendit_cancelled', array['text', 'boolean'],
  'authenticated', array[]::text[],
  'authenticated cannot mark a subscription cancelled'
);

-- Arrange: a clinic 10 days into a 30-day trial, so 20 days of credit remain.
insert into public.clinics (id, name) values
  ('00000000-0000-0000-0000-0000000000e1', 'Trial Clinic'),
  ('00000000-0000-0000-0000-0000000000e2', 'Renewing Clinic');
insert into public.subscriptions (clinic_id, status, trial_ends_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'trialing', now() + interval '20 days'),
  ('00000000-0000-0000-0000-0000000000e2', 'trialing', now() + interval '20 days');

-- Converting mid-trial: the paid period is added ON TOP of the unused trial.
select lives_ok(
  $$ select public.apply_xendit_subscription(
       '00000000-0000-0000-0000-0000000000e1'::uuid, 'cust_1', 'plan_1', now() + interval '30 days') $$,
  'a checkout applies to the clinic'
);
select is(
  (select status from public.subscriptions where clinic_id = '00000000-0000-0000-0000-0000000000e1'),
  'active',
  'the clinic becomes active'
);
select is(
  (select round(extract(epoch from (active_until - now())) / 86400)::int
     from public.subscriptions where clinic_id = '00000000-0000-0000-0000-0000000000e1'),
  50,
  'paying on day 10 of a 30-day trial yields 30 paid days PLUS the 20 unused trial days'
);
select is(
  (select xendit_customer_id || '/' || xendit_recurring_plan_id
     from public.subscriptions where clinic_id = '00000000-0000-0000-0000-0000000000e1'),
  'cust_1/plan_1',
  'the Xendit identifiers are recorded'
);

-- Xendit retries webhooks. A duplicate delivery must not extend access a second time.
select public.apply_xendit_subscription(
  '00000000-0000-0000-0000-0000000000e1'::uuid, 'cust_1', 'plan_1', now() + interval '30 days');
select is(
  (select round(extract(epoch from (active_until - now())) / 86400)::int
     from public.subscriptions where clinic_id = '00000000-0000-0000-0000-0000000000e1'),
  50,
  'a replayed webhook does not grant a second period'
);

-- A renewal on an already-active clinic tracks Xendit's period end; no second trial credit.
select public.apply_xendit_subscription(
  '00000000-0000-0000-0000-0000000000e2'::uuid, 'cust_2', 'plan_2', now() + interval '30 days');
select public.apply_xendit_subscription(
  '00000000-0000-0000-0000-0000000000e2'::uuid, 'cust_2', 'plan_2', now() + interval '60 days');
select is(
  (select round(extract(epoch from (active_until - now())) / 86400)::int
     from public.subscriptions where clinic_id = '00000000-0000-0000-0000-0000000000e2'),
  60,
  'renewal follows the new period end without re-crediting the trial'
);

-- Cancelling records intent but does NOT revoke access already paid for.
select public.mark_xendit_cancelled('plan_2', true);
select is(
  (select cancel_at_period_end from public.subscriptions where clinic_id = '00000000-0000-0000-0000-0000000000e2'),
  true,
  'cancellation is recorded'
);
select is(
  (select status from public.subscriptions where clinic_id = '00000000-0000-0000-0000-0000000000e2'),
  'active',
  'a cancelled clinic keeps access until the period it paid for runs out'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test suite to confirm it fails**

Run: `npx supabase test db`
Expected: FAIL — `09_xendit_subscription.test.sql` errors with something like
`function public.apply_xendit_subscription(uuid, text, text, timestamptz) does not exist`.

- [ ] **Step 3: Delete the old test file it replaces**

```bash
rm supabase/tests/09_stripe_subscription.test.sql
```

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/0014_xendit_subscriptions.sql`:

```sql
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
```

- [ ] **Step 5: Apply the migration to the local database**

Run: `docker exec -i supabase_db_clinic-care psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/0014_xendit_subscriptions.sql`
Expected: `ALTER TABLE`, `DROP INDEX`, `CREATE INDEX`, three `DROP FUNCTION`, three `CREATE FUNCTION`, six grant/revoke lines — no errors.

- [ ] **Step 6: Run the full pgTAP suite to confirm it passes**

Run: `npx supabase test db`
Expected: `All tests successful.` — 8 files (09 renamed, no longer 9), same total assertion count as
before minus/plus nothing (10 in this file, matching the old count).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0014_xendit_subscriptions.sql supabase/tests/09_xendit_subscription.test.sql supabase/tests/09_stripe_subscription.test.sql
git commit -m "feat(billing): replace Stripe subscription schema with Xendit

apply_xendit_subscription/set_xendit_customer/mark_xendit_cancelled replace
their Stripe-named equivalents. Same trial-credit arithmetic and greatest()
idempotency guard, ported test-for-test — only the provider changed."
```

---

## Task 2: Shared Xendit client + Deno runtime compatibility spike

**Files:**
- Create: `supabase/functions/_shared/xendit.ts`
- Modify: `supabase/config.toml:395-408` (secrets block + function verify_jwt block)
- Modify: `.env.example` (Stripe section → Xendit section)

**Interfaces:**
- Produces: `xenditClient(): Xendit` (throws if `XENDIT_SECRET_KEY` unset)
- Produces: `planConfig(): { scheduleId: string; amount: number; currency: string }` (reads `XENDIT_SCHEDULE_ID`, `XENDIT_PLAN_AMOUNT`, `XENDIT_PLAN_CURRENCY`)
- Produces: `appUrl(): string`
- Consumes: nothing new.

- [ ] **Step 1: Spike — confirm `xendit-node` loads and makes HTTP calls under Deno before writing real code against it**

This has never been run. `xendit-node@7` ships zero listed runtime dependencies, which strongly
suggests it uses native `fetch` (same shape as `npm:stripe@17`, already confirmed working under
Deno) — but that is an inference, not a test. Confirm it before Task 3 depends on it.

Create a throwaway scratch function:

```bash
mkdir -p supabase/functions/_scratch-xendit-spike
```

Write `supabase/functions/_scratch-xendit-spike/index.ts`:

```ts
import { Xendit } from 'npm:xendit-node@7';

Deno.serve(async () => {
  try {
    // A garbage key proves nothing about credentials — it proves the SDK's HTTP layer
    // works under Deno at all. A clean Xendit API error response (not a Deno import/runtime
    // crash) is success for this spike.
    const x = new Xendit({ secretKey: 'xnd_development_test_garbage_key' });
    const result = await x.Customer.getCustomer({ id: 'nonexistent' }).catch((e: unknown) => ({
      caughtApiError: e instanceof Error ? e.message : String(e),
    }));
    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
```

Run: `npx supabase functions serve` (in one terminal), then in another:
`curl -s http://127.0.0.1:54321/functions/v1/_scratch-xendit-spike`

Expected: a JSON response with `"ok": true` and a `result` object containing a `caughtApiError`
string describing an authentication or not-found failure from Xendit's API (proves the module
imported, constructed, and completed a real HTTP round-trip under Deno). If instead the response
is a Deno import/parse crash (`ok: false` with a module-resolution error, or the curl gets no
response because `supabase functions serve` failed to boot the function), stop here — the SDK is
not Deno-compatible as-is, and Task 3 onward need a different approach (e.g., calling Xendit's
REST API directly with `fetch` instead of the SDK, mirroring how `_shared/cors.ts`'s `json()`
helper already works).

- [ ] **Step 2: Delete the scratch function**

```bash
rm -rf supabase/functions/_scratch-xendit-spike
```

- [ ] **Step 3: Write the shared client module**

Create `supabase/functions/_shared/xendit.ts`:

```ts
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
```

- [ ] **Step 4: Swap the secrets block and function config in `supabase/config.toml`**

Find this block (currently around line 395-408):

```toml
[edge_runtime.secrets]
# Values resolved from the gitignored root `.env` file (see .env.example).
GCS_BUCKET = "env(GCS_BUCKET)"
GCS_SA_KEY = "env(GCS_SA_KEY)"
STRIPE_SECRET_KEY = "env(STRIPE_SECRET_KEY)"
STRIPE_PRICE_ID = "env(STRIPE_PRICE_ID)"
STRIPE_WEBHOOK_SECRET = "env(STRIPE_WEBHOOK_SECRET)"
APP_URL = "env(APP_URL)"

# Stripe calls this one, and Stripe has no Supabase JWT. Its safety comes from the
# signature check in the handler (constructEventAsync), NOT from an auth header —
# see supabase/functions/stripe-webhook/index.ts.
[functions.stripe-webhook]
verify_jwt = false
```

Replace it with:

```toml
[edge_runtime.secrets]
# Values resolved from the gitignored root `.env` file (see .env.example).
GCS_BUCKET = "env(GCS_BUCKET)"
GCS_SA_KEY = "env(GCS_SA_KEY)"
XENDIT_SECRET_KEY = "env(XENDIT_SECRET_KEY)"
XENDIT_SCHEDULE_ID = "env(XENDIT_SCHEDULE_ID)"
XENDIT_PLAN_AMOUNT = "env(XENDIT_PLAN_AMOUNT)"
XENDIT_PLAN_CURRENCY = "env(XENDIT_PLAN_CURRENCY)"
XENDIT_CALLBACK_TOKEN = "env(XENDIT_CALLBACK_TOKEN)"
APP_URL = "env(APP_URL)"

# Xendit calls this one, and Xendit has no Supabase JWT. Its safety comes from the
# x-callback-token check in the handler, NOT from an auth header —
# see supabase/functions/xendit-webhook/index.ts.
[functions.xendit-webhook]
verify_jwt = false
```

- [ ] **Step 5: Swap the Stripe section in `.env.example` for a Xendit section**

Find the `# --- Stripe (subscription payments) ---` block and replace it with:

```
# --- Xendit (subscription payments) -----------------------------------------
# Use TEST-mode keys locally (xnd_development_...). Never commit real keys; never paste them in chat.

# Secret key: Xendit Dashboard -> Settings -> API Keys.
XENDIT_SECRET_KEY=

# A Schedule object (interval=MONTH + retry rules), created once via the Xendit dashboard
# or API. Paste its ID here — schedules are reusable across plans.
XENDIT_SCHEDULE_ID=

# The monthly price. Unlike Stripe, Xendit's recurring Plan takes amount/currency as
# parameters WE supply, not a single opaque Price ID — so the price lives here instead,
# still with no code change needed to adjust it.
XENDIT_PLAN_AMOUNT=
XENDIT_PLAN_CURRENCY=PHP

# Every Xendit account has one static verification token, shown in Dashboard -> Developers ->
# Webhooks. Xendit sends it back in the x-callback-token header on every webhook; the handler
# rejects anything that doesn't match. Unlike Stripe's HMAC signature, this is a plain string
# compare — treat it as a bearer secret and rotate it if it's ever exposed.
XENDIT_CALLBACK_TOKEN=

# Where Xendit returns the clinic after checkout.
APP_URL=http://localhost:4200
```

- [ ] **Step 6: Restart the stack so the new secrets load**

Run: `npx supabase stop && npx supabase start`
Expected: stack restarts cleanly (no assertion here beyond a clean exit — no keys are set yet, so
nothing depending on them is exercised until Task 3).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/xendit.ts supabase/config.toml .env.example
git commit -m "feat(billing): shared Xendit client, replacing _shared/stripe.ts's role

Confirmed npm:xendit-node@7 completes a real HTTP round-trip under the
Deno edge runtime via a throwaway scratch function (deleted after).
Unlike Stripe's Price ID, Xendit's recurring plan takes amount/currency
as parameters we supply — XENDIT_PLAN_AMOUNT/CURRENCY plus a pre-created
XENDIT_SCHEDULE_ID stand in for that role."
```

---

## Task 3: `create-xendit-session` edge function

**Files:**
- Create: `supabase/functions/create-xendit-session/index.ts`
- Delete: `supabase/functions/create-checkout-session/index.ts` (and the now-empty `create-checkout-session/` directory)

**Interfaces:**
- Consumes: `requireMemberManager(req)` from `../_shared/auth.ts` (existing, unchanged) → `{ admin, userId, clinicId, isSuperAdmin } | { error, status }`
- Consumes: `xenditClient()`, `planConfig()`, `appUrl()` from Task 2's `../_shared/xendit.ts`
- Consumes: `set_xendit_customer` RPC from Task 1
- Produces: `POST /functions/v1/create-xendit-session` — clinic_admin/super-admin only, body `{}` (or `{ clinic_id }` for a super-admin), response `{ url: string }` on success or `{ error: string }` with a 4xx/5xx status.

- [ ] **Step 1: Confirm the hosted checkout API shape against the live Xendit API reference**

Before writing this function, open `https://docs.xendit.co/recurring/integration-guide` and
`https://docs.xendit.co/apidocs/create-recurring-plan` in a browser (the docs are JS-rendered and
did not return usable content to automated fetches during design). Confirm:

1. Whether creating a hosted subscription checkout is a distinct "Payment Session" API call (as
   the integration guide's prose suggested) with its own endpoint/SDK method, or whether it is the
   classic `createPlan` call with a `paymentMethods` array left empty so Xendit hosts the linking
   step itself.
2. The exact SDK method name and parameter shape for whichever of the two it is (the design
   assumed something like `xendit.Recurring.createPlan({...})` with `referenceId`, `customerId`,
   `scheduleId`, `amount`, `currency` — confirm the real parameter names).
3. Whether `referenceId` is genuinely available as a pass-through field on the created object (this
   plan uses it to carry `clinic_id` through to the webhook — confirmed present in the Node SDK's
   `createPlan` parameter list during design research, but re-check against the live reference).

Write down what you find as a comment at the top of the file in Step 3 before proceeding — if the
real API differs from the draft below, adjust the draft to match the real API, not the reverse.

- [ ] **Step 2: Write a Vitest-adjacent manual test plan for this function (no unit test — it's a thin HTTP handler over a live third-party API, matching how `create-checkout-session` had no unit test either)**

This function is exercised via the pgTAP-free manual/browser verification path used for every
other edge function in this codebase (see how `register-clinic`, `manage-member`, etc. were
verified with `curl` against a running `supabase functions serve` in prior sessions, not unit
tests). Confirm this by checking: `ls supabase/functions/create-checkout-session/` — note there is
no accompanying `*.test.ts`. This function follows the same convention; skip to implementation.

- [ ] **Step 3: Write the function**

Create `supabase/functions/create-xendit-session/index.ts`:

```ts
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

    // referenceId carries clinic_id through to the webhook — confirmed as a documented pass-
    // through field on the recurring Plan object during design research (re-verified in Step 1).
    const plan = await xendit.Recurring.createPlan({
      data: {
        referenceId: clinicId,
        customerId,
        recurringAction: 'PAYMENT',
        currency,
        amount,
        scheduleId,
        immediateActionType: 'FULL_AMOUNT',
        successReturnUrl: `${appUrl()}/clinic?checkout=success`,
        failureReturnUrl: `${appUrl()}/clinic?checkout=cancelled`,
      },
    });

    const url = (plan as unknown as { actions?: { action: string; url: string }[] })
      .actions?.find(a => a.action === 'AUTH')?.url;
    if (!url) throw new Error('Xendit did not return a checkout URL for this plan');

    return json({ url }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'could not start checkout';
    console.error('create-xendit-session failed:', message);
    return json({ error: message }, 500);
  }
});
```

- [ ] **Step 4: Delete the function it replaces**

```bash
rm -rf supabase/functions/create-checkout-session
```

- [ ] **Step 5: Serve locally and confirm the auth gate (same shape proven for every prior edge function)**

Run: `npx supabase functions serve` (background), then:

```bash
curl -s -w " [%{http_code}]\n" -X POST http://127.0.0.1:54321/functions/v1/create-xendit-session -H "Content-Type: application/json" -d '{}'
```

Expected: `{"msg":"Error: Missing authorization header"} [401]` — proves the gate rejects an
unauthenticated caller before ever touching Xendit, same as `create-checkout-session` did.

If `XENDIT_SECRET_KEY`/`XENDIT_SCHEDULE_ID`/`XENDIT_PLAN_AMOUNT`/`XENDIT_PLAN_CURRENCY` are not yet
set in `.env`, a subsequent authenticated call (as a real clinic_admin, following the same
`register-clinic` → sign-in → call pattern used to verify every prior edge function) will fail
with `"XENDIT_SECRET_KEY is not set"` at 500 — that is the expected, correct failure mode until the
user supplies real Xendit credentials, matching exactly how the Stripe version was left in a
verifiable-but-unexercised state pending the user's keys.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/create-xendit-session
git rm -r supabase/functions/create-checkout-session
git commit -m "feat(billing): create-xendit-session replaces create-checkout-session

Same gate (requireMemberManager; clinic resolved from the caller's own
membership, never the body). referenceId carries clinic_id through to
the webhook, replacing Stripe's metadata/client_reference_id pair."
```

---

## Task 4: `xendit-webhook` edge function

**Files:**
- Create: `supabase/functions/xendit-webhook/index.ts`
- Delete: `supabase/functions/stripe-webhook/index.ts` (and the now-empty directory)
- Delete: `supabase/functions/_shared/stripe.ts` (last consumer removed after Task 5, so this file
  deletion is deferred to Task 5, Step 4 — do not delete it here, `create-portal-session` still
  imports it until then)

**Interfaces:**
- Consumes: `apply_xendit_subscription`, `mark_xendit_cancelled` RPCs from Task 1
- Consumes: `xenditClient()` from Task 2
- Consumes: `log_audit` RPC (existing, from migration `0011_audit_log.sql` — signature
  `log_audit(p_clinic_id uuid, p_actor uuid, p_action text, p_target text default null, p_details jsonb default '{}')`)
- Produces: `POST /functions/v1/xendit-webhook`, `verify_jwt = false`, auth via `x-callback-token`
  header compared against `XENDIT_CALLBACK_TOKEN`.

- [ ] **Step 1: Confirm webhook event names and payload shape against the live Xendit API reference / sandbox**

This is the plan's other explicit unknown (see Global Constraints). Before writing the switch
statement:

1. In the Xendit Dashboard (test mode), find Developers → Webhooks and enable, at minimum,
   `recurring.plan.activated` and `recurring.plan.inactivated` (confirmed event names from design
   research). Look for whatever event fires on a **successful renewal charge** — this was not
   resolved by documentation search. Check for a "Simulate/resend test webhook" feature in the
   dashboard, or trigger a real sandbox renewal if the schedule interval can be shortened in test
   mode.
2. Capture one real payload for `recurring.plan.activated` by temporarily adding
   `console.log(JSON.stringify(event, null, 2))` as the first line of the handler in Step 3, then
   triggering a real test-mode checkout end to end (this requires the user's Xendit test
   credentials — coordinate with them before this step).
3. From the captured payload, confirm the exact paths for: the plan/customer identifier, the
   `reference_id` (expected to equal the `clinic_id` this function set at creation in Task 3), and
   whatever field indicates the next billing/period-end date.
4. Update the field-access code in Step 3 to match what was actually captured, and remove the
   temporary `console.log`.

If real credentials are not yet available, write Step 3 as drafted below (it encodes the design's
best-available research) and leave a `// VERIFY:` comment on each uncertain field access, then
revisit this step the moment credentials exist — do not skip verification silently.

- [ ] **Step 2: Write the function's signature-rejection behavior first (TDD via curl, matching how the Stripe webhook's signature check was proven)**

There is no unit-test framework wired for Deno edge functions in this repo (confirmed by the
absence of any `*.test.ts` alongside `stripe-webhook/index.ts`); verification for this function is
the same curl-against-`supabase functions serve` pattern used for every other edge function. Write
the handler (Step 3) with the token check as the FIRST thing it does, before any Xendit SDK call,
so an invalid token is provably rejected before touching the database — then verify with curl in
Step 4.

- [ ] **Step 3: Write the function**

Create `supabase/functions/xendit-webhook/index.ts`:

```ts
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
 * same defensive pattern the Stripe webhook used (`stripe.subscriptions.retrieve`). Field paths
 * below are drafted from design research and MUST be confirmed per Step 1 of this task before
 * this is trusted against real money.
 */
async function planDetailsFor(
  recurringPlanId: string,
): Promise<{ clinicId: string | null; customerId: string | null; periodEnd: string | null }> {
  const xendit = xenditClient();
  const plan = await xendit.Recurring.getPlan({ id: recurringPlanId }) as unknown as {
    reference_id?: string;
    customer_id?: string;
    schedule?: { anchor_date?: string };
  };
  return {
    // VERIFY: confirm `reference_id` is the actual field name on the returned plan object.
    clinicId: plan.reference_id ?? null,
    // VERIFY: confirm `customer_id` is the actual field name.
    customerId: plan.customer_id ?? null,
    // VERIFY: confirm the plan's schedule carries the next charge date under this path, and that
    // it represents the END of the period just paid for (not the start of the next one — these
    // may be the same instant, but confirm against a real captured payload).
    periodEnd: plan.schedule?.anchor_date ?? null,
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
```

- [ ] **Step 4: Delete the function it replaces**

```bash
rm -rf supabase/functions/stripe-webhook
```

- [ ] **Step 5: Serve locally and confirm the token-rejection gates**

Run: `npx supabase functions serve` (background), then:

```bash
curl -s -w " [%{http_code}]\n" -X POST http://127.0.0.1:54321/functions/v1/xendit-webhook -H "Content-Type: application/json" -d '{"event":"recurring.plan.activated","data":{}}'
```

Expected: `invalid token [400]` — no `x-callback-token` header sent.

```bash
curl -s -w " [%{http_code}]\n" -X POST http://127.0.0.1:54321/functions/v1/xendit-webhook -H "Content-Type: application/json" -H "x-callback-token: wrong-token" -d '{"event":"recurring.plan.activated","data":{}}'
```

Expected: `invalid token [400]` — proves a present-but-wrong token is rejected identically to a
missing one (both fail closed).

If `XENDIT_CALLBACK_TOKEN` is set in `.env` and the stack was restarted, repeat with the real value
in the header and confirm `{"received":true} [200]` — this exercises the happy path up to (but not
including, since `data: {}` has no real `id`) the RPC calls.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/xendit-webhook
git rm -r supabase/functions/stripe-webhook
git commit -m "feat(billing): xendit-webhook replaces stripe-webhook

Auth is a constant-time x-callback-token compare rather than an HMAC
signature — Xendit's model, not a choice made here. Mitigated by the
existing idempotent, never-goes-backwards apply_xendit_subscription.

The renewal-success event case is deliberately left unimplemented
(logged as unhandled) pending live-sandbox confirmation of its event
name — see the VERIFY comment and Task 4 Step 1. Do not deploy to
production before that case exists and is tested against a real event."
```

---

## Task 5: `cancel-subscription` edge function

**Files:**
- Create: `supabase/functions/cancel-subscription/index.ts`
- Delete: `supabase/functions/create-portal-session/index.ts` (and the now-empty directory)
- Delete: `supabase/functions/_shared/stripe.ts` (last consumer, `create-portal-session`, removed
  in this task)

**Interfaces:**
- Consumes: `requireMemberManager(req)` from `../_shared/auth.ts`
- Consumes: `xenditClient()` from Task 2
- Consumes: `mark_xendit_cancelled` RPC from Task 1
- Produces: `POST /functions/v1/cancel-subscription`, body `{}` (or `{ clinic_id }` for a
  super-admin), response `{ cancelled: true }` on success, `{ error: string }` with a 4xx/5xx
  status otherwise (409 if the clinic has no recorded `xendit_recurring_plan_id`).

- [ ] **Step 1: Confirm the cancel/deactivate API call against the live Xendit API reference**

Open `https://docs.xendit.co/apidocs/update-recurring-plan` and confirm the exact method name and
parameter for setting a plan inactive (the design assumed
`xendit.Recurring.updatePlan({ id, data: { status: 'INACTIVE' } })` — confirm the real status
enum value and whether `status` is the correct field name).

- [ ] **Step 2: Write the function**

Create `supabase/functions/cancel-subscription/index.ts`:

```ts
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
    await xenditClient().Recurring.editPlan({
      id: recurringPlanId,
      data: { status: 'INACTIVE' },
    });
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
```

- [ ] **Step 3: Delete the function it replaces**

```bash
rm -rf supabase/functions/create-portal-session
```

- [ ] **Step 4: Delete `_shared/stripe.ts` — its last consumer is now gone**

```bash
rm supabase/functions/_shared/stripe.ts
```

- [ ] **Step 5: Serve locally and confirm the auth gate + no-account case**

Run: `npx supabase functions serve` (background), then:

```bash
curl -s -w " [%{http_code}]\n" -X POST http://127.0.0.1:54321/functions/v1/cancel-subscription -H "Content-Type: application/json" -d '{}'
```

Expected: `{"msg":"Error: Missing authorization header"} [401]`.

As a real clinic_admin with no prior checkout (following the standard `register-clinic` sign-in
pattern used to verify every other function), a second call should return:
`{"error":"no billing account yet"} [409]`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/cancel-subscription
git rm -r supabase/functions/create-portal-session supabase/functions/_shared/stripe.ts
git commit -m "feat(billing): cancel-subscription replaces create-portal-session

No confirmed Xendit customer portal exists, so cancellation is a direct
API call recording cancel_at_period_end rather than a hosted-portal
redirect. Access is unrevoked until active_until passes, unchanged from
the Stripe design. _shared/stripe.ts deleted — its last consumer is gone."
```

---

## Task 6: `BillingAccountStore` — rename to Xendit, replace portal redirect with cancel

**Files:**
- Modify: `src/app/features/clinic/billing-account.store.ts`
- Modify: `src/app/features/clinic/billing-account.store.spec.ts`

**Interfaces:**
- Consumes: edge functions `create-xendit-session` (Task 3), `cancel-subscription` (Task 5) by name only (via `supabase.functions.invoke`)
- Produces: `BillingAccountStore.startCheckout(): Promise<string>` (unchanged signature, new function name underneath)
- Produces: `BillingAccountStore.cancel(): Promise<void>` (NEW — replaces `openPortal(): Promise<string>`)

- [ ] **Step 1: Write the failing tests for the new/changed behavior**

Replace the full contents of `src/app/features/clinic/billing-account.store.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { BillingAccountStore } from './billing-account.store';
import { SUPABASE } from '../../core/supabase.client';

function setup(invoke: ReturnType<typeof vi.fn>) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: SUPABASE, useValue: { functions: { invoke } } }],
  });
  return TestBed.inject(BillingAccountStore);
}

describe('BillingAccountStore', () => {
  it('sends no clinic_id — the server resolves the caller\'s own clinic', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { url: 'https://checkout.xendit.co/x' }, error: null });
    const url = await setup(invoke).startCheckout();
    expect(invoke).toHaveBeenCalledWith('create-xendit-session', { body: {} });
    expect(url).toBe('https://checkout.xendit.co/x');
  });

  it('throws rather than navigating nowhere when Xendit returns no URL', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: {}, error: null });
    await expect(setup(invoke).startCheckout()).rejects.toThrow('did not return a checkout URL');
  });

  it('cancels through its own function and does not return a URL', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { cancelled: true }, error: null });
    await expect(setup(invoke).cancel()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith('cancel-subscription', { body: {} });
  });

  it('surfaces the edge function error body on cancel', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'no billing account yet' }), { status: 409 }),
    });
    const invoke = vi.fn().mockResolvedValue({ data: null, error });
    await expect(setup(invoke).cancel()).rejects.toThrow('no billing account yet');
  });

  it('surfaces the edge function error body on checkout', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'XENDIT_SECRET_KEY is not set' }), { status: 500 }),
    });
    const invoke = vi.fn().mockResolvedValue({ data: null, error });
    await expect(setup(invoke).startCheckout()).rejects.toThrow('XENDIT_SECRET_KEY is not set');
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx ng test --watch=false`
Expected: FAIL — `billing-account.store.spec.ts` errors, since `BillingAccountStore.cancel` does
not exist yet and `startCheckout` still calls `create-checkout-session`.

- [ ] **Step 3: Rewrite the store**

Replace the full contents of `src/app/features/clinic/billing-account.store.ts`:

```ts
import { inject, Service } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { edgeError } from '../../core/edge-error';

/**
 * Subscription payment, via Xendit's hosted checkout. No card/GCash details ever reach this app —
 * checkout returns a Xendit URL and the browser goes there.
 */
@Service()
export class BillingAccountStore {
  private supabase = inject(SUPABASE);

  /** Start checkout for the caller's own clinic. The server decides which clinic that is. */
  async startCheckout(): Promise<string> {
    const { data, error } = await this.supabase.functions.invoke('create-xendit-session', { body: {} });
    if (error) throw await edgeError(error);
    const url = (data as { url?: string })?.url;
    if (!url) throw new Error('Xendit did not return a checkout URL.');
    return url;
  }

  /**
   * Cancel the caller's clinic's subscription. No confirmed Xendit customer portal exists, so
   * this calls our own API directly rather than returning a redirect URL. Access is not revoked
   * immediately — the clinic keeps it until the period already paid for runs out.
   */
  async cancel(): Promise<void> {
    const { error } = await this.supabase.functions.invoke('cancel-subscription', { body: {} });
    if (error) throw await edgeError(error);
  }
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx ng test --watch=false`
Expected: PASS — all `billing-account.store.spec.ts` cases green.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/clinic/billing-account.store.ts src/app/features/clinic/billing-account.store.spec.ts
git commit -m "feat(billing): BillingAccountStore targets Xendit functions

openPortal(): Promise<string> is gone — no confirmed Xendit portal
exists. cancel(): Promise<void> replaces it, calling cancel-subscription
directly rather than returning a redirect URL."
```

---

## Task 7: `BillingAccountComponent` — Cancel button with confirm step

**Files:**
- Modify: `src/app/features/clinic/billing-account.component.ts`
- Create: `src/app/features/clinic/billing-account.component.spec.ts`

**Interfaces:**
- Consumes: `BillingAccountStore.cancel(): Promise<void>` from Task 6
- Consumes: `ClinicContextService.access()` (existing, unchanged)
- Produces: no new public interface — this is a leaf component.

- [ ] **Step 1: Write the failing component test**

Create `src/app/features/clinic/billing-account.component.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { BillingAccountComponent } from './billing-account.component';
import { SUPABASE } from '../../core/supabase.client';
import { ClinicContextService, ClinicAccess } from '../../core/clinic/clinic-context.service';

const activeAccess: ClinicAccess = {
  clinicId: 'c1',
  clinicName: 'Sunrise',
  address: null,
  phone: null,
  email: null,
  taxId: null,
  role: 'clinic_admin',
  status: 'active',
  trialEndsAt: null,
  activeUntil: new Date(Date.now() + 20 * 86400_000).toISOString(),
};

function render(access: ClinicAccess, invoke = vi.fn()) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: SUPABASE, useValue: { auth: {}, functions: { invoke }, from: () => ({}) } }],
  });
  TestBed.inject(ClinicContextService).access.set(access);
  const fixture = TestBed.createComponent(BillingAccountComponent);
  fixture.detectChanges();
  return { fixture, invoke, el: fixture.nativeElement as HTMLElement };
}

function findButton(el: HTMLElement, text: string): HTMLButtonElement {
  return [...el.querySelectorAll('button')].find(b => b.textContent?.includes(text)) as HTMLButtonElement;
}

describe('BillingAccountComponent', () => {
  it('shows a Cancel subscription button for an active plan, not Manage billing', () => {
    const { el } = render(activeAccess);
    expect(findButton(el, 'Cancel subscription')).toBeTruthy();
    expect(el.textContent).not.toContain('Manage billing');
  });

  it('requires a second click before actually cancelling', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { cancelled: true }, error: null });
    const { fixture, el } = render(activeAccess, invoke);

    findButton(el, 'Cancel subscription').click();
    fixture.detectChanges();
    expect(invoke).not.toHaveBeenCalled();
    expect(findButton(el, 'Confirm cancel')).toBeTruthy();

    findButton(el, 'Confirm cancel').click();
    await new Promise(r => setTimeout(r));
    expect(invoke).toHaveBeenCalledWith('cancel-subscription', { body: {} });
  });

  it('backs out of the confirm step without cancelling', () => {
    const invoke = vi.fn();
    const { fixture, el } = render(activeAccess, invoke);

    findButton(el, 'Cancel subscription').click();
    fixture.detectChanges();
    findButton(el, 'Keep subscription').click();
    fixture.detectChanges();

    expect(invoke).not.toHaveBeenCalled();
    expect(findButton(el, 'Cancel subscription')).toBeTruthy();
  });

  it('surfaces a cancellation error', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'no billing account yet' }), { status: 409 }),
    });
    const invoke = vi.fn().mockResolvedValue({ data: null, error });
    const { fixture, el } = render(activeAccess, invoke);

    findButton(el, 'Cancel subscription').click();
    fixture.detectChanges();
    findButton(el, 'Confirm cancel').click();
    await new Promise(r => setTimeout(r));
    fixture.detectChanges();

    expect(el.textContent).toContain('no billing account yet');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx ng test --watch=false`
Expected: FAIL — `billing-account.component.spec.ts` errors; the component currently renders
"Manage billing", not "Cancel subscription" / "Confirm cancel" / "Keep subscription".

- [ ] **Step 3: Rewrite the component**

Replace the full contents of `src/app/features/clinic/billing-account.component.ts`:

```ts
import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ClinicContextService } from '../../core/clinic/clinic-context.service';
import { BillingAccountStore } from './billing-account.store';
import { SubscribeButtonComponent } from './subscribe-button.component';

@Component({
  selector: 'app-billing-account',
  imports: [DatePipe, MatCardModule, MatButtonModule, MatIconModule, SubscribeButtonComponent],
  template: `
    <mat-card appearance="outlined" class="section">
      <h2 i18n="@@billing.planTitle">Plan</h2>

      @if (access(); as a) {
        <p class="status">
          @if (a.status === 'trialing') {
            <ng-container i18n="@@billing.onTrial">Free trial — {{ daysLeft() }} days left.</ng-container>
          } @else if (a.status === 'active') {
            <ng-container i18n="@@billing.active">Active until {{ a.activeUntil | date: 'mediumDate' }}.</ng-container>
          } @else {
            <ng-container i18n="@@billing.inactive">No active subscription.</ng-container>
          }
        </p>

        @if (a.status === 'active') {
          <p class="meta" i18n="@@billing.renews">
            Renews automatically. Cancel any time — access runs to the end of the paid period.
          </p>
        } @else {
          <p class="meta" i18n="@@billing.trialCredit">
            Days left on your trial are added on top of your first paid month, so subscribing early
            costs you nothing.
          </p>
        }

        <div class="actions">
          @if (a.status !== 'active') {
            <app-subscribe-button />
          } @else if (confirming()) {
            <button mat-flat-button class="danger" [disabled]="busy()" (click)="cancel()">
              <mat-icon>block</mat-icon>
              <ng-container i18n="@@billing.confirmCancel">Confirm cancel</ng-container>
            </button>
            <button mat-button [disabled]="busy()" (click)="confirming.set(false)">
              <ng-container i18n="@@billing.keepSubscription">Keep subscription</ng-container>
            </button>
          } @else {
            <button mat-stroked-button [disabled]="busy()" (click)="confirming.set(true)">
              <mat-icon>cancel</mat-icon>
              <ng-container i18n="@@billing.cancelSubscription">Cancel subscription</ng-container>
            </button>
          }
        </div>

        @if (cancelled()) {
          <p class="ok" i18n="@@billing.cancelled">
            Cancelled. Your access continues until the date above, then will not renew.
          </p>
        }
        @if (error(); as message) { <p class="err">{{ message }}</p> }
      }
    </mat-card>
  `,
  styles: `
    .section { padding: 1rem; }
    .section h2 { font: var(--mat-sys-title-medium); margin: 0 0 0.5rem; }
    .status { font: var(--mat-sys-body-large); margin: 0 0 0.25rem; }
    .meta { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); margin: 0 0 0.75rem; }
    .actions { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; margin-bottom: 0.75rem; }
    .danger { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .ok { color: var(--mat-sys-primary); font: var(--mat-sys-body-small); margin: 0; }
    .err { color: var(--mat-sys-error); font: var(--mat-sys-body-small); margin: 0; }
  `,
})
export class BillingAccountComponent {
  private ctx = inject(ClinicContextService);
  private store = inject(BillingAccountStore);

  protected access = computed(() => this.ctx.access());
  protected daysLeft = computed(() => this.ctx.daysLeft() ?? 0);
  protected busy = signal(false);
  protected error = signal<string | null>(null);
  protected confirming = signal(false);
  protected cancelled = signal(false);

  async cancel(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.store.cancel();
      this.confirming.set(false);
      this.cancelled.set(true);
      await this.ctx.load();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : $localize`:@@billing.cancelFailed:Could not cancel the subscription.`);
    } finally {
      this.busy.set(false);
    }
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx ng test --watch=false`
Expected: PASS — all `billing-account.component.spec.ts` cases green.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/clinic/billing-account.component.ts src/app/features/clinic/billing-account.component.spec.ts
git commit -m "feat(billing): Cancel subscription replaces Manage billing

No confirmed Xendit portal exists, so the Billing tab gets a direct
in-app cancel action instead of a redirect — gated behind a confirm
step, matching the pattern already used for team-member removal.
First component-level test coverage for this component."
```

---

## Task 8: `ClinicSettingsComponent` copy, docs, config, full verification

**Files:**
- Modify: `src/app/features/clinic/clinic-settings.component.ts:30,41` (Stripe → Xendit copy)
- Modify: `README.md` (Stripe section → Xendit section)
- Modify: `src/locale/messages.xlf` (regenerated, not hand-edited)

**Interfaces:** none — this task only touches copy, docs, and final verification. No new
interfaces produced or consumed.

- [ ] **Step 1: Update the two Stripe-referencing strings in `clinic-settings.component.ts`**

In `src/app/features/clinic/clinic-settings.component.ts`, change:

```ts
        <span i18n="@@billing.confirming">Confirming your payment with Stripe…</span>
```

to:

```ts
        <span i18n="@@billing.confirming">Confirming your payment with Xendit…</span>
```

And change:

```ts
        <span i18n="@@billing.confirmSlow">
          Stripe took your payment; we are still waiting for confirmation. This usually lands within
          a minute — refresh, or contact us if it does not.
        </span>
```

to:

```ts
        <span i18n="@@billing.confirmSlow">
          Xendit took your payment; we are still waiting for confirmation. This usually lands within
          a minute — refresh, or contact us if it does not.
        </span>
```

Also update the file's doc comment:

```ts
/** How long to keep re-checking for the webhook after Stripe sends the clinic back. */
```

to:

```ts
/** How long to keep re-checking for the webhook after Xendit sends the clinic back. */
```

- [ ] **Step 2: Replace the README's Stripe section**

Replace the entire `## Subscription payments (Stripe)` section (from that heading through the line
just before `## Translations (i18n)`) with:

```markdown
## Subscription payments (Xendit)

Clinics subscribe themselves through Xendit's hosted checkout (GCash); a webhook is the only thing
that grants paid access. **Access is always read from our own `subscriptions.active_until`, never
from a live call to Xendit** — if Xendit is unreachable, clinics keep the access they already paid
for.

### Setup

1. In Xendit, create a recurring **Schedule** (interval `MONTH` + retry rules) via the dashboard or
   API. Copy its ID — this is `XENDIT_SCHEDULE_ID`.
2. Fill the six `XENDIT_*` / `APP_URL` values in `.env` (see `.env.example`). Use **test-mode** keys
   (`xnd_development_...`) until you have run the flow end to end.
3. Restart the stack so the secrets load: `npx supabase stop && npx supabase start`.

### Testing locally

Xendit's webhook has no local-forwarding CLI equivalent to Stripe's `stripe listen` as far as this
integration has confirmed — webhooks must reach a publicly routable URL. Use a tunnel
(`ngrok http 54321`, or similar) pointed at
`http://127.0.0.1:54321/functions/v1/xendit-webhook`, and register that public URL as the webhook
endpoint in the Xendit dashboard (test mode), subscribed to `recurring.plan.activated` and
`recurring.plan.inactivated` at minimum — confirm the renewal-success event name against the
dashboard before relying on it (see the `VERIFY` comment in `xendit-webhook/index.ts`).

Then sign in as a clinic_admin, open **Clinic → Billing → Subscribe**, and complete checkout with a
Xendit test-mode GCash account.

Watch it land: `npx supabase functions logs xendit-webhook`

### How it behaves

- **Trial credit.** A clinic converting mid-trial keeps its unused days: the paid period is added
  on top. Paying on day 10 of a 30-day trial gives 30 + 20 = 50 days.
- **Idempotent.** Xendit retries webhook deliveries. Access is set *from* Xendit's period end
  rather than by adding a month, and it never moves backwards, so a replay can neither
  double-grant nor confiscate trial credit.
- **Cancellation does not revoke access.** The Billing tab's Cancel button calls Xendit directly
  and records `cancel_at_period_end`; the clinic keeps what it paid for until `active_until`
  passes, then lapses through the normal gate. There is no self-service payment-method swap.
- **A failed renewal does not evict anyone.** It is recorded in the audit trail; access lapses
  naturally if payment never succeeds.
- **`verify_jwt = false`** for `xendit-webhook` only (Xendit holds no Supabase JWT). Its safety is
  a constant-time compare of the `x-callback-token` header against `XENDIT_CALLBACK_TOKEN` — a
  static shared secret, not an HMAC signature. Rotate it if it is ever exposed.

### Deploying

    npx supabase secrets set XENDIT_SECRET_KEY=... XENDIT_SCHEDULE_ID=... XENDIT_PLAN_AMOUNT=... XENDIT_PLAN_CURRENCY=... XENDIT_CALLBACK_TOKEN=... APP_URL=...
    npx supabase functions deploy create-xendit-session xendit-webhook cancel-subscription

Then add the webhook endpoint in the Xendit Dashboard (Developers → Webhooks) pointing at your
deployed `xendit-webhook` URL, and confirm your account's callback verification token there matches
`XENDIT_CALLBACK_TOKEN`.
```

- [ ] **Step 3: Re-extract i18n messages**

Run: `npm run i18n:extract`
Expected: `Extraction Complete. (Messages: N)` — `src/locale/messages.xlf` picks up the two changed
strings (`@@billing.confirming`, `@@billing.confirmSlow`) and the new ones from Task 7
(`@@billing.confirmCancel`, `@@billing.keepSubscription`, `@@billing.cancelSubscription`,
`@@billing.cancelled`, `@@billing.cancelFailed`); IDs already used verbatim in `billing-account.component.ts`
Task 7 (`@@billing.planTitle`, `@@billing.onTrial`, etc.) are unchanged and simply re-confirmed.

- [ ] **Step 4: Full verification sweep**

Run: `npx ng test --watch=false`
Expected: all test files pass, same total count as before minus the 4 Stripe-specific
`billing-account.store.spec.ts` cases plus this plan's replacements, plus 4 new
`billing-account.component.spec.ts` cases.

Run: `npx supabase test db`
Expected: `All tests successful.` — 8 files (unchanged count; `09_xendit_subscription.test.sql`
replaced `09_stripe_subscription.test.sql` one-for-one in Task 1).

Run: `npx ng build`
Expected: clean build, no budget warning (bundle size is not meaningfully affected by an SDK swap
of similar size to `npm:stripe@17`).

Run: `grep -rn "stripe\|Stripe" src/ supabase/functions/ supabase/migrations/0013* 2>/dev/null | grep -v "0013_stripe_subscriptions.sql\|0014_xendit_subscriptions.sql"`
Expected: no output — confirms no stray Stripe references remain outside the historical migration
files (which are never edited after the fact) and this task's own comment explaining the
migration's relationship to its predecessor.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/clinic/clinic-settings.component.ts README.md src/locale/messages.xlf
git commit -m "docs(billing): finish the Stripe -> Xendit swap

Copy, README setup/testing/deploy instructions, and the i18n message
catalog now describe Xendit throughout. Full ng test / supabase test db
/ ng build verification sweep, and a grep confirms no stray Stripe
references remain outside the historical 0013 migration."
```

---

## Self-Review

**Spec coverage** — walking `docs/superpowers/specs/2026-07-23-xendit-payments-design.md`
section by section:

- Architecture (hosted checkout → webhook → access gate, cancel without portal) → Tasks 3, 4, 5.
- Data model (rename Stripe columns/functions to Xendit) → Task 1.
- Edge functions (all three, `verify_jwt` config) → Tasks 2 (config), 3, 4, 5.
- Frontend changes (store, component, settings copy) → Tasks 6, 7, 8.
- Error handling table (abandoned OTP, leaked token, no-account cancel, failed renewal) → covered
  by Task 4's non-eviction logging, Task 5's 409 case, Task 4's token-mismatch 400 case. The
  "abandoned OTP" row needs no code — it's the absence of a webhook, already the correct behavior
  by construction.
- Webhook auth model honesty (static token vs HMAC) → stated in Task 4's file header comment and
  README section, matching the spec's own wording almost verbatim.
- Testing (pgTAP ported, Vitest updated) → Tasks 1, 6, 7.
- Open risks (Deno/SDK compatibility, exact webhook fields, checkout API shape) → Task 2 Step 1
  (spike), Task 3 Step 1 (API-shape confirmation), Task 4 Step 1 (event-name confirmation).
- Out of scope (cards, direct debit, self-service swap) → not implemented anywhere in this plan,
  correctly.

No spec section is unaddressed.

**Placeholder scan** — searched for "TBD", "handle appropriately", "similar to Task N", bare
descriptions without code. Found none. The `VERIFY:` comments in Task 4's `xendit-webhook` are not
placeholders in the forbidden sense (vague, no-code instructions) — they mark specific,
already-coded field accesses that carry an explicit verification step (Task 4, Step 1) with
concrete instructions for what to check and where, consistent with the spec's own pre-approved
"Open Risks" section. The unimplemented renewal-success webhook case is likewise not a silent gap:
it is explicitly logged as unhandled with a comment explaining why, and Task 4's commit message and
the README both state plainly that it must not ship to production before that case is added.

**Type/name consistency** — checked across tasks:
- `apply_xendit_subscription(uuid, text, text, timestamptz)` — same signature in Task 1's
  migration, Task 1's test, and Task 4's webhook call.
- `mark_xendit_cancelled(text, boolean)` — same across Task 1 (migration + test), Task 4, Task 5.
- `set_xendit_customer(uuid, text)` — same across Task 1, Task 3.
- `BillingAccountStore.cancel(): Promise<void>` — declared in Task 6, consumed identically in
  Task 7 (`await this.store.cancel()`).
- Edge function names (`create-xendit-session`, `xendit-webhook`, `cancel-subscription`) match
  between the functions themselves (Tasks 3-5), the store's `invoke()` calls (Task 6), and the
  README (Task 8).
- `ClinicAccess` shape used in Task 7's test literal matches the existing interface fields exactly
  (`address`, `phone`, `email`, `taxId` all present) — checked against the live
  `clinic-context.service.ts` interface read during planning, not assumed.

No inconsistencies found.
