# Xendit Subscription Payments (replacing Stripe) — Design

**Date:** 2026-07-23
**Status:** Approved for planning
**Milestone:** Replace the Stripe subscription integration with Xendit, so clinics can pay by
GCash — the method Stripe cannot offer this account.

## Problem

`b0befd2` built self-serve Stripe subscriptions, but the account backing it is a US-registered
entity, and Stripe gates GCash — the payment method Philippine clinics actually expect — behind a
Philippine-registered business. That entity doesn't exist. Card-only checkout is the fallback, and
it was never exercised against live Stripe before this decision was made to replace it.

Xendit explicitly supports GCash for foreign-incorporated businesses through its Global Account
(covering PH, ID, MY, TH, VN under one multi-currency setup), which is the deciding fact for this
switch.

## Decisions (locked during brainstorming)

- **Full replace, not addition.** No clinic has ever paid through the Stripe path — it never went
  live. The Stripe integration is removed rather than kept alongside a second provider.
- **GCash only at launch.** The method that motivated the switch. Cards and direct debit are
  additive later without a redesign.
- **No self-service payment-method swap.** No confirmed Xendit equivalent to Stripe's customer
  billing portal exists. Cancellation is a plain in-app button calling Xendit's API directly;
  changing the linked GCash account is out of scope for v1.
- **Everything above the provider boundary is unchanged.** Access is still gated by our own
  `subscriptions.active_until`, never a live provider call. Trial-credit arithmetic, its
  idempotency guard, and the audit trail all carry over with the same test coverage, just
  re-pointed at Xendit's functions.

## Architecture

```
Angular SPA
  │
  ├─(clinic_admin JWT)──▶ create-xendit-session ─(server key)─▶ Xendit Checkout
  │                         resolves clinic from caller's own      (payment_session,
  │                         membership, never the request body      type SUBSCRIPTION)
  │                                                                       │
  │                                                          customer redirects, links
  │                                                          GCash via OTP, in one page
  │
  ├── Xendit ──(webhooks: payment_session.completed → recurring_plan.activated →
  │             recurring.cycle.created per renewal, plan-status events)──▶ xendit-webhook
  │             verifies x-callback-token (constant-time compare)
  │             → apply_xendit_subscription() RPC → same trial-credit arithmetic,
  │               same idempotency-by-greatest() guard, same audit_log entries
  │
  └─(clinic_admin JWT)──▶ cancel-subscription ─(server key)─▶ Xendit Update Recurring Plan
                            (status inactive); no hosted portal exists, so this is a direct
                            API call, not a redirect. Access still runs to active_until.
```

### What stays identical to the Stripe design

These live above the provider boundary and don't care which provider is underneath:

- `subscriptions.active_until` is the only thing that gates access — never a live provider call.
- Trial-credit math: unused trial days are added on top of the first paid period.
- The `greatest()` idempotency guard that stops a duplicate webhook delivery from clawing back
  already-credited days (Xendit retries webhooks too).
- Audit trail entries for register / pay / cancel.
- The Billing tab shell, `SubscribeButtonComponent`, and blocked-screen / trial-banner placement.
- `ClinicSettingsComponent`'s post-checkout polling loop, which only watches
  `ctx.access()?.status === 'active'` and doesn't know or care which provider set it.

### What's genuinely new

- Checkout is Xendit's hosted `payment_session` (type `SUBSCRIPTION`) — a different API shape from
  Stripe Checkout, but the same "redirect out, redirect back, webhook grants access" pattern.
- Webhook auth is a static `x-callback-token` string match, not an HMAC signature (see Error
  Handling below for what this does and doesn't protect against).
- No billing-portal equivalent, so "Manage billing" becomes a plain **Cancel subscription** button.
- GCash only; cards and direct debit are each a separate linking/auth flow to add later.

## Data Model

New migration `0014_xendit_subscriptions.sql`, replacing `0013`'s Stripe columns rather than
layering on top (no clinic has paid yet, so no backfill or dual-write period is needed):

```sql
alter table public.subscriptions
  drop column stripe_customer_id,
  drop column stripe_subscription_id,
  -- cancel_at_period_end stays — the concept is provider-agnostic
  add column xendit_customer_id text,
  add column xendit_recurring_plan_id text;

create index subscriptions_xendit_plan_idx on public.subscriptions (xendit_recurring_plan_id);
```

Functions renamed, bodies otherwise unchanged from `0013` (including the `greatest()` fix):

- `apply_stripe_subscription(...)` → `apply_xendit_subscription(p_clinic_id, p_customer_id, p_recurring_plan_id, p_period_end)`
- `mark_stripe_cancelled(...)` → `mark_xendit_cancelled(p_recurring_plan_id, p_cancel_at_period_end)`
- `set_stripe_customer(...)` → `set_xendit_customer(p_clinic_id, p_customer_id)`

## Edge Functions

Deleted: `create-checkout-session`, `stripe-webhook`, `create-portal-session`, `_shared/stripe.ts`.

Added:

**`_shared/xendit.ts`** — mirrors `_shared/stripe.ts`'s shape:

```ts
export function xenditClient()  // reads XENDIT_SECRET_KEY, throws if unset
export function planId()        // XENDIT_PLAN_ID reference — schedule/amount config, not hardcoded
export function appUrl()
```

**`create-xendit-session`** — same gate as the Stripe function it replaces
(`requireMemberManager`; clinic resolved from the caller's own membership, never the request body).
Creates a Xendit customer if none is recorded yet (`set_xendit_customer`), then a `payment_session`
of type `SUBSCRIPTION` referencing that customer + plan, with `success_return_url` /
`failure_return_url` pointed at `/clinic?checkout=success|cancelled` — the same redirect targets
`ClinicSettingsComponent` already watches for.

**`xendit-webhook`** — `verify_jwt = false` in `config.toml`, same reasoning as the Stripe webhook:
Xendit holds no Supabase JWT. Handles `payment_session.completed` (first payment →
`apply_xendit_subscription`), the paid-confirmation event for each renewal cycle, and plan-status
events for cancellation → `mark_xendit_cancelled`. Failed-payment events are logged to `audit_log`
with access untouched, matching the existing non-eviction policy.

**`cancel-subscription`** (replaces `create-portal-session`) — same gate, calls Xendit's Update
Recurring Plan to set the plan inactive, then `mark_xendit_cancelled` locally so the UI reflects
the change without waiting on the webhook round-trip.

## Frontend Changes

- **`BillingAccountStore`** — `startCheckout()` stays, calling `create-xendit-session`.
  `openPortal()` becomes `cancel()`, calling `cancel-subscription` and awaiting a confirmation
  rather than a redirect URL.
- **`SubscribeButtonComponent`** — unchanged: disables on click, redirects, does not re-enable on
  success since the tab is navigating away.
- **`BillingAccountComponent`** — "Manage billing" becomes "Cancel subscription," gated behind a
  confirm step (matching the pattern already used for team-member removal — a destructive action
  gets a second click). Copy referencing Stripe-hosted card/invoice management is removed, since
  there is no portal to point to.
- **`ClinicSettingsComponent`**'s post-checkout confirmation polling is unchanged — it only reads
  `ctx.access()?.status`.

## Error Handling & Edge Cases

| Case | Behavior |
|---|---|
| Customer abandons the GCash OTP step | No webhook fires; the clinic's status is unchanged. Returning to `/clinic` without `?checkout=success` shows the plan as it was — no false "confirming" state. |
| Webhook token leaked or rotated | The old token stops matching; requests get `400` until `XENDIT_CALLBACK_TOKEN` is updated on both sides. No silent failure mode. |
| `cancel-subscription` called with no `xendit_recurring_plan_id` yet | `409`, same shape as the `create-portal-session` "no billing account yet" case it replaces. |
| A renewal payment fails | Logged to `audit_log`; access is untouched — Stripe's non-eviction policy carries over unchanged. |

**On the webhook auth model, stated plainly rather than glossed over:** Xendit signs nothing. It
sends the account's static `x-callback-token` in a header; the handler does a constant-time string
compare against `XENDIT_CALLBACK_TOKEN`. That proves the request holds the token, not that the
payload is untampered HMAC-verified data, and there is no built-in replay window the way Stripe's
timestamped signature provided one. What already mitigates most of the gap: `apply_xendit_subscription`
is idempotent and (via the `greatest()` guard) never moves `active_until` backwards, so a replayed
or duplicated webhook can neither double-grant nor claw back access. What it does *not* stop: a
leaked token being replayable indefinitely. Rotate it if it is ever exposed, same as any bearer
secret.

## Testing

- **pgTAP** — `09_stripe_subscription.test.sql` becomes `09_xendit_subscription.test.sql`, same 10
  cases ported to the renamed functions: the 50-day trial-credit case, replay-safety via
  `greatest()`, renewal tracking Xendit's period end without re-crediting, and cancel-keeps-access.
  No arithmetic changes — only the provider the functions are wired to changed.
- **Vitest** — `billing-account.store.spec.ts` updated for the renamed edge functions and the
  `cancel()` method replacing `openPortal()`.
- **Manual** — Xendit sandbox checkout with a GCash test account; a duplicate webhook delivery
  (via Xendit's dashboard resend, if available, or a manual replay) confirmed not to alter
  `active_until`; a cancel confirmed to leave access intact until `active_until` passes.

## Open Risks (verify during implementation, not guessed at design time)

- **`xendit-node`'s Deno compatibility is unverified.** It ships zero runtime dependencies
  (likely native `fetch`, the same shape as `npm:stripe@17`, which is confirmed working under
  Deno), but this hasn't been run. First implementation step: a throwaway smoke test importing it
  in a scratch edge function and calling one read-only endpoint, before any real code depends on it.
- **The exact field name for a paid period's end date** in the `recurring.cycle.created` / plan
  webhook payload isn't confirmed from documentation — the API reference pages are JS-rendered and
  didn't return usable content to an automated fetch. The webhook handler's period-end extraction
  gets written against Xendit's sandbox test events during implementation.
- **The hosted Checkout UI's exact request shape** (`payment_session` type `SUBSCRIPTION`) is
  summarized from an integration-guide fetch, not a verified live API reference read. Confirmed
  against the real reference once implementation starts.

None of these block planning — they are spike-first tasks inside the plan, the same way
`register_clinic`'s RPC design was verified against a running local Postgres before being trusted.

## Out of Scope (v1)

- Cards, direct debit, usage-based billing.
- Self-service payment-method swap (changing the linked GCash account).
- Any dual-provider fallback or keeping Stripe available alongside Xendit.
- Settlement-currency handling beyond what Xendit's dashboard already provides.
