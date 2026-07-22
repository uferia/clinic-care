# Clinic Self-Signup + 30-Day Trial — Design

**Date:** 2026-07-22
**Status:** Approved for planning
**Milestone:** Remove the super-admin from the onboarding path. A clinic registers itself, starts a
30-day trial immediately, and invites its own staff.

## Problem

Onboarding is fully admin-driven today (see
`docs/superpowers/specs/2026-07-18-multi-tenant-subscription-design.md`). Every new clinic requires
the super-admin to call `create-clinic`, then `add-members` for each staff email. A Google account
that is on no clinic's list lands on `/no-access` and can do nothing but wait.

That makes the owner a bottleneck on every signup and every new hire. We want a clinic to register
and start using the product with no manual approval, like any other SaaS provider.

## Decisions (locked during brainstorming)

- **Scope: trial only.** Self-signup grants a 30-day trial. Conversion to a paid subscription stays
  manual — the owner still runs `set-subscription` from `/admin`. No payment provider in this
  milestone.
- **Trial: 30 days**, up from 14, for *both* signup paths. Existing subscription rows are untouched.
- **Entry point: the existing `/no-access` screen.** It keeps its "ask your admin" copy for staff
  waiting on an invite and gains a "create your clinic" form below it. No separate `/signup` route.
- **Self-registrant becomes `clinic_admin`** of the clinic they create.
- **Clinic admins invite their own staff.** `add-members` accepts a `clinic_admin` caller scoped to
  their own clinic. Without this, self-signup would still route every new hire back through the
  owner.
- **Guard rails stay minimal.** `memberships.email` is already globally unique, so one Google
  account maps to one clinic for its lifetime. Google OAuth blocks bot signups. The owner sees every
  clinic in `/admin` and keeps `expire-clinic` as a kill switch. No domain rules, no captcha, no
  `created_via` column.
- **Mechanism: a `register-clinic` edge function calling a `security definer` RPC.** The auth check
  lives in TypeScript with the other gates; the three inserts run in one Postgres transaction.

## Architecture

```
Angular SPA
  │
  ├─(user JWT)──▶ register-clinic  ─(service role)─▶ register_clinic()   ── one tx:
  │                 verify JWT,                        clinics
  │                 no membership required             + subscriptions (trialing, +30d)
  │                                                    + memberships (clinic_admin, bound)
  │
  └─(user JWT)──▶ add-members      ─(service role)─▶ memberships insert
                    super-admin: any clinic_id
                    clinic_admin: own clinic only (body clinic_id ignored)
```

`register-clinic` is the first edge function not gated by `requireSuperAdmin`. It requires a valid
Supabase session and nothing more.

### Why the RPC takes caller identity as arguments

The edge function calls Postgres with the service-role key, so `auth.uid()` inside the function is
null. `register_clinic` therefore accepts `p_user_id` and `p_email`, which the edge function has
already verified from the caller's JWT. `execute` is revoked from `public`, `anon`, and
`authenticated` and granted only to `service_role`, so the function is unreachable from the client
and the only path in is through the edge function's JWT check.

## Server Changes

### New migration `0008_self_signup.sql`

```sql
public.register_clinic(p_user_id uuid, p_email citext, p_name text) returns public.clinics
  language plpgsql, security definer, set search_path = public
```

Body, in order:

1. `p_name := trim(p_name)`; raise `name required` when empty.
2. Raise `already a member` when `memberships` holds `p_email` or `p_user_id`.
3. `insert into clinics (name) values (p_name)`.
4. `insert into subscriptions (clinic_id, status, trial_ends_at) values (new_id, 'trialing', now() + interval '30 days')`.
5. `insert into memberships (clinic_id, email, role, user_id) values (new_id, p_email, 'clinic_admin', p_user_id)`.
6. Return the clinic row.

Then:

```sql
revoke execute on function public.register_clinic(uuid, citext, text) from public, anon, authenticated;
grant  execute on function public.register_clinic(uuid, citext, text) to service_role;
```

All five steps share one transaction: a failure at any point leaves no clinic, no subscription, and
no membership.

### New edge function `register-clinic`

```
POST register-clinic { name }
  handleCors
  verify caller JWT via anon client -> user      (401 when absent/invalid)
  require user.email                             (400 'email required')
  service-role client -> rpc('register_clinic', { p_user_id, p_email, p_name })
  map: 'name required' -> 400, 'already a member' -> 409, other -> 500
  -> { clinic }
```

### `add-members` authorization change

New helper in `supabase/functions/_shared/auth.ts`:

```
requireMemberManager(req) -> { admin, userId, clinicId | null, isSuperAdmin } | { error, status }
```

- Caller in `super_admins` → `isSuperAdmin: true`; the handler uses the body's `clinic_id`
  (today's behavior, unchanged).
- Otherwise the caller must hold a membership with `role = 'clinic_admin'` → the handler forces
  `clinic_id` to that membership's clinic and **ignores any `clinic_id` in the body**.
- Otherwise `403`.

The rest of `add-members` — normalize, de-dup, skip globally taken emails, report
`{ inserted[], skipped[] }` — is unchanged. A `clinic_admin` may invite with either role
(`clinic_admin` or `staff`) inside their own clinic, so a clinic can have more than one admin.

Note that `memberships.user_id` carries no unique constraint; the `p_user_id` check in
`register_clinic` is a friendly guard, and the race-proof constraint is the unique `email`.

### `create-clinic`

Trial window `14 * 86400_000` → `30 * 86400_000`. No other change; the function stays
super-admin-only for the owner's manual path.

### RLS

No change. `memberships_read` already lets any member read their own clinic's membership rows, which
is exactly what the team screen needs. Writes continue to go only through edge functions.

## Frontend Changes

**`core/clinic/clinic-context.service.ts`** — the membership query also selects `role`;
`ClinicAccess` gains `role: 'clinic_admin' | 'staff'`; new `isClinicAdmin` computed. Nothing else
changes.

**`core/auth/clinic-admin.guard.ts`** (new) — passes when `ctx.isClinicAdmin()`, otherwise redirects
to `/dashboard`.

**`features/access/no-access.component.ts`** — keeps its current copy for staff awaiting an invite,
and adds a second block: "Starting a new clinic?" with a clinic-name input and a **Create clinic**
button. The button is disabled while a request is in flight. On success it calls `ctx.load()` then
navigates to `/dashboard`. Errors render through the existing `core/form-errors.ts` banner pattern.

**`features/access/registration.store.ts`** (new) — one method `register(name)` invoking
`register-clinic`, surfacing the edge function's error body rather than the generic
`FunctionsHttpError` message (same approach as commit `f0e38ad`).

**`features/team/`** (new):

- `team.store.ts` — reads `memberships` for the caller's clinic (RLS scopes it, no explicit filter
  needed); `invite(emails, role)` invokes `add-members` **without** a `clinic_id`, since the server
  forces it.
- `team.component.ts` — member list with bound/unbound state, an email textarea, a role select, and
  a result line reporting `inserted[]` / `skipped[]`. Laid out to match
  `features/admin/admin-clinic-detail.component.ts` so it reads like the rest of the app.

**`app.routes.ts`** — `/team` under `[authGuard, accessGuard, clinicAdminGuard]`.

**`app.html`** — a "Team" toolbar link shown when `clinic.isClinicAdmin()`, beside the existing Admin
link.

**Blocked screen** — unchanged. An expired trial routes here regardless of how the clinic was
created, and the owner activates from `/admin`.

## Error Handling & Edge Cases

| Case | Behavior |
|---|---|
| Caller already has a membership | `409`; UI reports the account is already linked to a clinic and re-runs `ctx.load()` |
| Double submit / concurrent requests | Button disabled in flight; the unique `memberships.email` constraint fails the second call and the transaction rolls back — no orphan clinic |
| Google account with no email | `400`; a membership cannot be bound without one |
| Blank or whitespace clinic name | `400`; validated in the form and again in the function |
| Email already seeded into another clinic | `409`. One person, one clinic — that clinic must remove them first |
| `clinic_admin` posts a foreign `clinic_id` to `add-members` | Ignored; forced to their own clinic server-side, not merely hidden in the UI |
| Staff (non-admin) calls `add-members` | `403` |
| Super-admin self-registers | Allowed, no special case; they become a `clinic_admin` and keep `/admin` |
| Trial ends | Existing blocked screen; the owner activates from `/admin` |
| Supabase/network failure | Existing save-error banner pattern |

## Testing

**pgTAP — `supabase/tests/04_register.test.sql`**

- `register_clinic` creates exactly one clinic, one `trialing` subscription ~30 days out, and one
  `clinic_admin` membership bound to the given `user_id`.
- A second call with the same email raises, and leaves zero orphan clinics (proves atomicity).
- `execute` is denied to the `authenticated` role.

**Edge functions**

- `register-clinic` with no Authorization header → `401`.
- `register-clinic` for a user who already has a membership → `409`.
- `add-members` called by a `staff` member → `403`.
- `add-members` called by a `clinic_admin` with another clinic's `clinic_id` → the row lands in the
  caller's own clinic.

**Vitest — `npx ng test --watch=false`**

- `clinicAdminGuard`: admin passes, staff redirects.
- `registration.store`: success path, and error-body surfacing on failure.
- `team.store`: row mapping and the no-`clinic_id` invite payload.
- `clinic-context`: exposes `role` and `isClinicAdmin`.

**Playwright — screenshots captured at each step**

Screenshots are written to the session scratchpad (not the repo, to keep image blobs out of git) and
shared in-chat during verification:

1. `/no-access` showing the create-clinic form
2. The form filled, pre-submit
3. `/dashboard` after creation, toolbar reading `Trial · 30d left`
4. `/team` invite screen
5. A staff account signed in — no Team link present

## Out of Scope

- Payments (Stripe or otherwise); self-serve renewal or upgrade.
- Removing members or changing a member's role after invite.
- Email notification to invited staff (they simply sign in with Google).
- Clinic deletion or self-serve cancellation.
- Signup analytics, `created_via` tracking, domain allow/deny rules, captcha.
- Transferring `clinic_admin` ownership.
