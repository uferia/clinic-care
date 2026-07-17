# Multi-Tenant Access + Subscription — Design

**Date:** 2026-07-18
**Status:** Approved for planning
**Milestone:** Turn ClinicCare from a single shared demo into a multi-clinic product with owner-controlled subscriptions.

## Problem

Today ClinicCare is a single-tenant Angular SPA backed by `json-server` (`db.json`) with
Google Sign-In that is **client-trusted only** (see the security note in
`src/app/core/auth/auth.service.ts` — the mock API cannot verify the token). All patients,
doctors, and appointments live in one shared dataset.

We want:

1. **Multi-tenant access** — many separate clinics use the app, each seeing only its own data.
2. **Subscription gating** — a clinic gets a 14-day free trial, then is blocked until the owner
   activates a paid subscription. The owner activates/renews manually (payment is offline for now).

Neither is enforceable on `json-server`: it has no auth boundary, no per-tenant isolation, and any
client with devtools can bypass a client-side flag. This milestone replaces the backend with a
real server boundary.

## Decisions (locked during brainstorming)

- **Backend:** Supabase (Postgres + Row-Level Security + Supabase Auth Google provider).
- **Tenant model:** a **clinic** is the tenant. Many staff belong to one clinic and share its data.
  One person belongs to exactly one clinic (email is globally unique).
- **Enforcement (Approach B):** RLS enforces tenant isolation + subscription gating on all normal
  data; a small set of Edge Functions (service role) handle privileged cross-tenant super-admin
  writes. Client never writes clinics/subscriptions/memberships directly.
- **Onboarding:** fully **admin-driven**. The super-admin (the owner) creates clinics and
  bulk-seeds staff emails from an in-app super-admin area. No public self-signup.
- **Trial:** 14 days, clock starts at clinic creation.
- **Activation:** owner sets a monthly expiry (`active_until`); renewal is additive (1-month
  chunks by default). Blocks again when it passes.
- **Unlisted login:** a Google account whose email is on no clinic's list gets a "no access" screen.
- **Super-admin surface:** in-app `/admin` area, styled with the existing Angular Material look.

## Architecture Overview

```
Angular SPA ──(supabase-js, user JWT)──▶ Supabase Postgres
     │                                      ├─ RLS: tenant isolation + subscription gating
     │                                      └─ tables: clinics, subscriptions, memberships,
     │                                                 super_admins, patients, doctors, appointments
     └──(super-admin only, user JWT)──▶ Supabase Edge Functions (service role)
                                            └─ create-clinic, add-members, set-subscription,
                                               expire-clinic  (cross-tenant writes)
```

- Normal tenant reads/writes go **direct** via `supabase-js`; RLS scopes and gates them.
- Privileged cross-tenant writes go **only** through Edge Functions, gated to the super-admin.

## Data Model (Postgres)

All ids are `uuid`. Existing `json-server` string ids are throwaway demo data.

```
super_admins
  user_id  uuid null          -- bound on first login
  email    citext unique      -- seed: ulysses.feria@gmail.com

clinics
  id          uuid pk
  name        text
  created_at  timestamptz default now()

subscriptions            -- 1:1 with clinic
  clinic_id      uuid pk fk clinics
  status         text          -- 'trialing' | 'active' | 'expired'
  trial_ends_at  timestamptz   -- created_at + 14d
  active_until   timestamptz null   -- set on activate/renew
  updated_at     timestamptz
  updated_by     uuid          -- super_admin who last changed

memberships              -- pre-seeded staff, by email
  id         uuid pk
  clinic_id  uuid fk clinics
  email      citext unique      -- one person = one clinic
  role       text               -- 'clinic_admin' | 'staff'
  user_id    uuid null          -- null until first Google login binds it
  created_at timestamptz

patients / doctors / appointments
  + clinic_id  uuid fk clinics  -- added to all three; server-owned (default/trigger)
```

Notes:

- **Doctors become per-clinic** (today they are a global list). Each clinic owns its own patients,
  doctors, appointments.
- **Membership binds on first login:** email is seeded now with `user_id = null`; on the person's
  first Google sign-in, `user_id` is set where `email` matches and `user_id is null` (idempotent).
- **Subscription is its own row** (not a flag on clinic) for a clean audit trail
  (`updated_by`/`updated_at`) and because only the super-admin writes it.
- **`status` is a stored mirror.** RLS computes live access from `now()` vs `trial_ends_at` /
  `active_until`; `status` is a convenience column the admin UI displays.

## RLS + Subscription Gating

Two helper functions drive every policy:

```sql
-- clinic the current user belongs to (via bound membership)
current_clinic_id() -> uuid
  = select clinic_id from memberships where user_id = auth.uid();

-- is that clinic's subscription live right now?
current_clinic_active() -> boolean
  = exists( select 1 from subscriptions s
            where s.clinic_id = current_clinic_id()
              and ( (s.status = 'trialing' and s.trial_ends_at > now())
                 or (s.status = 'active'   and s.active_until > now()) ) );
```

Policies:

| Table | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|
| patients / doctors / appointments | `clinic_id = current_clinic_id() AND current_clinic_active()` | same |
| clinics / subscriptions / memberships (own row) | member reads own clinic's row — **not** active-gated | no client writes |
| clinics / subscriptions / memberships (all rows) | super-admin may read all (SELECT-only cross-tenant) | via Edge Functions only |

Rationale:

- **Isolation:** a user's `current_clinic_id()` never equals another clinic's rows → cross-tenant
  read returns zero rows. Enforced in Postgres, not JS.
- **Automatic gating:** an expired clinic makes `current_clinic_active()` false → every domain query
  returns zero rows and every write fails. No client flag to flip.
- **Blocked screen still loads:** subscription/clinic/membership reads are not active-gated, so an
  expired user can still render "why blocked" + trial-days-left.
- **No client writes** to clinics/subscriptions/memberships — those go through Edge Functions.
  Domain-table writes set `clinic_id` server-side (default/trigger) so the client cannot spoof it.

Access resolution at app load (drives which screen shows):

- no bound membership → **No-access** screen
- membership + `current_clinic_active()` true → **app**
- membership + `current_clinic_active()` false → **Blocked** (trial/plan over) screen

## Edge Functions (service role)

Each function: verify caller JWT → confirm caller is in `super_admins` → else `403`. Service role
bypasses RLS, so these are the only cross-tenant writers.

```
POST create-clinic { name }
  -> insert clinic
  -> insert subscription { status:'trialing', trial_ends_at: now()+14d }
  -> returns clinic + subscription

POST add-members { clinic_id, emails[], role }
  -> bulk insert memberships (email lowercased, user_id null)
  -> skip + report duplicates (email is globally unique)
  -> returns { inserted[], skipped[] }

POST set-subscription { clinic_id, action:'activate'|'renew', months? }
  -> active_until = max(now(), coalesce(active_until, now())) + months*30d   (months default 1)
  -> status='active', updated_by=caller, updated_at=now()
  -> returns subscription

POST expire-clinic { clinic_id }          -- optional kill-switch
  -> status='expired'
```

Notes:

- **Bulk insert seeds emails, not accounts.** No passwords — Google owns auth. Rows stay
  `user_id=null` until each person's first Google login binds them.
- **Renew is additive** (`max(now, active_until)`) so early renewal does not lose remaining days.
- **Admin list views** use an RLS SELECT policy that lets super-admins read all clinics/subscriptions
  — no function needed. Functions are for writes only.
- `super_admins` is seeded once with the owner's email via a SQL migration.
- Future: the admin UI may add an explicit custom-date renewal in addition to month chunks.

## Auth Migration (Supabase Auth)

Raw Google-GIS (client-trusted JWT) is replaced by **Supabase Auth, Google provider**. Google login
stays, but the token becomes Supabase-issued and server-verified so RLS can trust `auth.uid()`.

- **Add** `@supabase/supabase-js`; one shared `SupabaseClient` provider. Google client-id moves to
  the Supabase dashboard (Auth → Google provider), out of `auth.config.ts`.
- **`auth.service.ts`** reworked: `signInWithOAuth({provider:'google'})`, `signOut()`, and
  `user`/session from `supabase.auth.onAuthStateChange` + `getSession()`. Drop hand-rolled
  `decodeJwt`, `waitForGis`, localStorage session, and exp checks — Supabase owns them.
- **`auth.interceptor.ts`** — deleted (`supabase-js` attaches the bearer itself).
- **`auth.guard.ts`** — async: valid Supabase session? else `/login`.
- **New `access.guard.ts`** — after auth: resolve membership + `current_clinic_active()`, route to
  app / `/no-access` / `/blocked`.
- **New `superAdminGuard`** — gate `/admin`.
- **`login.component.ts`** — swap the GIS rendered button for a Supabase Google sign-in button.
- **`google.d.ts`** — deleted.

## Frontend Changes (Angular)

**Data layer:**

- Remove `core/api.ts` base URL + `HttpClient` domain calls. Stores (`patient.store`,
  `doctor.store`, `appointment.store`, `dashboard.store`) call `supabase.from('...')...`.
- No manual `clinic_id` filtering in queries — RLS scopes rows. Writes rely on the server to set
  `clinic_id` (default/trigger), so the client cannot spoof it.
- Models gain a read-only `clinicId`.

**New gating screens** (routed by `access.guard`):

- `NoAccessComponent` — "your email isn't on any clinic. Contact your admin."
- `SubscriptionBlockedComponent` — trial/plan ended; shows status + date; no app nav.

**Super-admin area** (`/admin`, `superAdminGuard`, Angular Material to match existing look):

- Clinics list — name, status badge, trial/active dates.
- Create clinic (name → `create-clinic`).
- Clinic detail — bulk-add members (textarea of emails + role → `add-members`), activate/renew
  buttons (`set-subscription`), member list showing bound/unbound state.

**Toolbar:** clinic name + plan badge (`Trial · N days left` / `Active until <date>`). Super-admin
also sees an "Admin" link.

**Routes:** existing `dashboard/patients/doctors/appointments` stay under `authGuard` + new
`accessGuard`; add `/admin/**` under `superAdminGuard`; add `/no-access`, `/blocked`.

**Config:** `environment.ts` gains `supabaseUrl` + `supabaseAnonKey`.

## Error Handling & Edge Cases

- **Login email on no clinic** → `access.guard` finds no membership → `/no-access`. A state, not an error.
- **Clinic expires mid-session** → next domain query returns zero rows / write rejected by RLS. Stores
  catch RLS-empty + write-denied and route to `/blocked`; the plan badge also re-checks status on nav.
- **Edge fn called by non-super-admin** → `403`. The admin UI hides itself via guard, but the server
  still refuses — defense in depth.
- **Duplicate email in bulk-add** (already in another clinic) → reported in `skipped[]`; UI lists which
  were skipped and why.
- **First login binds membership** → a bind step sets `memberships.user_id = auth.uid()` where `email`
  matches and `user_id is null`. Idempotent (DB trigger on auth user creation, or a `bind-membership`
  call on first load).
- **Supabase/network down** → stores surface the existing save-error banner pattern.
- **Renew on already-active** → additive; no lost days.

## Testing

- **RLS (pgTAP or integration):** clinic A user reads zero of clinic B's rows; expired clinic returns
  zero rows + write denied; trialing/active returns own rows; membership binds by email exactly once.
- **Edge functions:** non-super-admin → 403; `create-clinic` sets trial +14d; `set-subscription`
  additive renew; `add-members` dedups.
- **Angular (Vitest):** `authGuard` (session / no session), `accessGuard` (member / no-member /
  active / expired → correct route), `superAdminGuard`, stores map supabase rows to models. Mock the
  supabase client.
- **Manual E2E:** create clinic → add a test email → login binds → use app on trial → super-admin
  expire → blocked screen.

## Out of Scope (v1)

- Public self-signup for clinics.
- Staff self-invite flows (owner bulk-seeds emails instead).
- Real payment processing (Stripe etc.) — activation is manual/offline.
- Cross-clinic reporting, per-role permissions beyond `clinic_admin`/`staff`.
- Migrating existing `db.json` demo data (throwaway; seed one demo clinic instead).
