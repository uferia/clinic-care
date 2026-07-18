# Phase 5 — Super-Admin Area + Edge Functions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the platform owner an in-app super-admin area to create clinics, bulk-add staff emails, and activate/renew subscriptions — with the privileged cross-tenant writes running in Supabase Edge Functions (service role, gated to super-admins), replacing manual Supabase Studio edits.

**Architecture:** Reads for the admin area go direct via `supabase-js` (RLS already lets a super-admin read all clinics/subscriptions/memberships — the `OR is_super_admin()` policies from Phase 1). Privileged WRITES go through Edge Functions (`create-clinic`, `add-members`, `set-subscription`, `expire-clinic`) that verify the caller is in `super_admins`, then use the service-role key to bypass RLS. The Angular app detects super-admin status (own `super_admins` row) to show an "Admin" link + gate `/admin` with a `superAdminGuard`. Tenant data flow and the access-gating screens from earlier phases are untouched.

**Tech Stack:** Supabase Edge Functions (Deno + `@supabase/supabase-js`), Angular 22 (standalone, signals), Angular Material, Vitest + jsdom.

## Global Constraints

- Privileged cross-tenant writes (create clinic, add members, set/expire subscription) happen ONLY in Edge Functions using the service-role key, gated by a `super_admins` check. The client never writes clinics/subscriptions/memberships directly (RLS forbids it anyway).
- Every Edge Function: verify a valid caller JWT → confirm caller `user_id` ∈ `super_admins` → else return 403. Bulk email inserts are lowercased and de-duplicated (report skipped).
- Trial = 14 days from creation (`trial_ends_at = now()+14d`). `set-subscription` renew is additive: `active_until = max(now, active_until) + months*30d`, default 1 month, `status='active'`.
- Admin READS use `supabase-js` directly (super-admin RLS returns all rows). Angular calls Edge Functions via `supabase.functions.invoke(name, { body })` (attaches the caller's JWT automatically).
- Edge Functions get `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` auto-injected by the local runtime — do not hardcode or commit keys.
- Angular tests: `npx ng test [--include=...] --watch=false` from **PowerShell**. **Every Angular task verifies BOTH `npx ng test --watch=false` AND `npx ng build`.**
- **Before claiming any UI task done, load the running app in Playwright** (`browser_navigate` http://localhost:4200, `browser_snapshot`, `browser_console_messages` level error = 0) — ng test/build do not catch bootstrap/runtime crashes.
- Commits carry NO `Co-Authored-By:` / Anthropic / Claude trailer — repo default author only.

---

### Task 1: Super-admin detection + superAdminGuard + Admin link

**Files:**
- Modify: `src/app/core/clinic/clinic-context.service.ts`
- Modify: `src/app/core/clinic/clinic-context.service.spec.ts`
- Create: `src/app/core/auth/super-admin.guard.ts`
- Create: `src/app/core/auth/super-admin.guard.spec.ts`
- Modify: `src/app/app.ts`, `src/app/app.html`

**Interfaces:**
- Consumes: `SUPABASE`, `ClinicContextService`.
- Produces: `ClinicContextService.isSuperAdmin: Signal<boolean>` (loaded in `load()`); `superAdminGuard: CanActivateFn` (allows when `isSuperAdmin()`, else redirects to `/dashboard`); an "Admin" toolbar link visible to super-admins.

- [ ] **Step 1: Extend the context spec (failing)**

Add to `src/app/core/clinic/clinic-context.service.spec.ts` — update the `makeClient` helper to also answer the `super_admins` table and add a test. Replace the `from` mock so it handles a third table, and add `superAdmin` to the opts:

```ts
// in makeClient opts, add: superAdmin?: { user_id: string } | null;
// and in the `from` mock, add a branch:
//   table === 'super_admins' ? maybeSingle(opts.superAdmin ?? null) : ...
```

Concretely, replace the `from` mock body with:

```ts
from: vi.fn((table: string) => ({
  select: () =>
    table === 'memberships' ? maybeSingle(opts.membership ?? null)
    : table === 'subscriptions' ? maybeSingle(opts.subscription ?? null)
    : maybeSingle(opts.superAdmin ?? null),
})),
```

Add this test to the `describe`:

```ts
it('flags a super-admin when a super_admins row exists', async () => {
  const future = new Date(Date.now() + 5 * 86400_000).toISOString();
  const svc = setup(makeClient({
    userId: 'u1',
    membership: { clinic_id: 'c1', clinics: { name: 'Demo Clinic' } },
    subscription: { status: 'trialing', trial_ends_at: future, active_until: null },
    superAdmin: { user_id: 'u1' },
  }));
  await svc.load();
  expect(svc.isSuperAdmin()).toBe(true);
});

it('is not a super-admin without a super_admins row', async () => {
  const svc = setup(makeClient({ userId: 'u1', membership: null, superAdmin: null }));
  await svc.load();
  expect(svc.isSuperAdmin()).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx ng test --include="src/app/core/clinic/clinic-context.service.spec.ts" --watch=false`
Expected: FAIL — `isSuperAdmin` does not exist.

- [ ] **Step 3: Add super-admin detection to the context service**

In `src/app/core/clinic/clinic-context.service.ts`, add a signal + populate it in `load()`. Add near the other signals:

```ts
readonly isSuperAdmin = signal(false);
```

Inside `load()`, after obtaining `uid` (and before/after the membership fetch — it needs only `uid`), add:

```ts
const { data: sa } = await this.supabase
  .from('super_admins')
  .select('user_id')
  .eq('user_id', uid)
  .maybeSingle();
this.isSuperAdmin.set(!!sa);
```

In `clear()`, also reset it: `this.isSuperAdmin.set(false);`

(Place the `super_admins` query right after the `if (!uid) { ... return; }` guard so it always runs for a signed-in user, even one with no clinic membership.)

- [ ] **Step 4: Run the context spec (passes)**

Run: `npx ng test --include="src/app/core/clinic/clinic-context.service.spec.ts" --watch=false`
Expected: PASS (now 6 tests).

- [ ] **Step 5: Write the guard test (failing)**

Create `src/app/core/auth/super-admin.guard.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { RouterStateSnapshot, ActivatedRouteSnapshot, UrlTree, provideRouter } from '@angular/router';
import { superAdminGuard } from './super-admin.guard';
import { ClinicContextService } from '../clinic/clinic-context.service';
import { SUPABASE } from '../supabase.client';

function run() {
  return TestBed.runInInjectionContext(() =>
    superAdminGuard({} as ActivatedRouteSnapshot, { url: '/admin' } as RouterStateSnapshot));
}

describe('superAdminGuard', () => {
  function configure() {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SUPABASE, useValue: { auth: {}, from: () => ({}) } }],
    });
    return TestBed.inject(ClinicContextService);
  }

  it('allows a super-admin', () => {
    const ctx = configure();
    ctx.isSuperAdmin.set(true);
    expect(run()).toBe(true);
  });

  it('redirects a non-super-admin to /dashboard', () => {
    const ctx = configure();
    ctx.isSuperAdmin.set(false);
    const r = run();
    expect(r).toBeInstanceOf(UrlTree);
    expect((r as UrlTree).toString()).toContain('/dashboard');
  });
});
```

- [ ] **Step 6: Implement the guard**

Create `src/app/core/auth/super-admin.guard.ts`:

```ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ClinicContextService } from '../clinic/clinic-context.service';

export const superAdminGuard: CanActivateFn = () => {
  const ctx = inject(ClinicContextService);
  const router = inject(Router);
  return ctx.isSuperAdmin() ? true : router.createUrlTree(['/dashboard']);
};
```

- [ ] **Step 7: Add the Admin link in the toolbar**

In `src/app/app.html`, inside the `@if (clinic.isActive()) { <nav …> … </nav> }` block, after the last nav link (inside the `@for` sibling, i.e. right after the `@for` loop closes but still inside `<nav>`), add a super-admin-only link:

```html
@if (clinic.isSuperAdmin()) {
  <a mat-button routerLink="/admin" routerLinkActive="active-link">
    <mat-icon>admin_panel_settings</mat-icon>
    <span class="nav-text">Admin</span>
  </a>
}
```

(`clinic` is already injected in `app.ts`. `RouterLink`/`RouterLinkActive`/`MatIconModule`/`MatButtonModule` are already imported by `App`.)

- [ ] **Step 8: Verify + Playwright + commit**

Run: `npx ng test --watch=false` → green. `npx ng build` → no TS errors.
Load the app in Playwright (http://localhost:4200) → confirm it renders (login or app) with 0 console errors.

```bash
git add src/app/core/clinic/clinic-context.service.ts src/app/core/clinic/clinic-context.service.spec.ts src/app/core/auth/super-admin.guard.ts src/app/core/auth/super-admin.guard.spec.ts src/app/app.ts src/app/app.html
git commit -m "feat(admin): super-admin detection, guard, and toolbar link"
```

---

### Task 2: Edge Function shared helpers + create-clinic

**Files:**
- Create: `supabase/functions/_shared/cors.ts`
- Create: `supabase/functions/_shared/auth.ts`
- Create: `supabase/functions/create-clinic/index.ts`

**Interfaces:**
- Consumes: auto-injected `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Produces: `requireSuperAdmin(req)` → `{ admin: SupabaseClient, user }` or `{ error, status }`; `corsHeaders`, `json(body, status)`, `handleCors(req)`; the `create-clinic` function returning `{ clinic }`.

- [ ] **Step 1: Write the CORS helper**

Create `supabase/functions/_shared/cors.ts`:

```ts
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Return a preflight response for OPTIONS, else null. */
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  return null;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 2: Write the auth helper**

Create `supabase/functions/_shared/auth.ts`. Import specifier: `jsr:@supabase/supabase-js@2` is the Supabase-recommended one for the edge runtime; if the local runtime fails to resolve it, switch both the import here to `npm:@supabase/supabase-js@2` (also supported) — pick whichever `npx supabase functions serve` resolves without error, and keep it consistent.

```ts
import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface Gate {
  admin: SupabaseClient;
  userId: string;
}

/**
 * Verify the caller's JWT and confirm they are a super-admin.
 * Returns a service-role client on success, or an error tuple.
 */
export async function requireSuperAdmin(
  req: Request,
): Promise<Gate | { error: string; status: number }> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return { error: 'unauthorized', status: 401 };

  // Resolve the caller from their JWT.
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error } = await caller.auth.getUser();
  if (error || !user) return { error: 'unauthorized', status: 401 };

  // Service-role client for the privileged checks + writes.
  const admin = createClient(url, service);
  const { data: sa } = await admin.from('super_admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!sa) return { error: 'forbidden', status: 403 };

  return { admin, userId: user.id };
}
```

- [ ] **Step 3: Write create-clinic**

Create `supabase/functions/create-clinic/index.ts`:

```ts
import { handleCors, json } from '../_shared/cors.ts';
import { requireSuperAdmin } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const gate = await requireSuperAdmin(req);
  if ('error' in gate) return json({ error: gate.error }, gate.status);

  let name: string;
  try {
    name = (await req.json()).name;
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  if (!name?.trim()) return json({ error: 'name is required' }, 400);

  const { data: clinic, error } = await gate.admin
    .from('clinics')
    .insert({ name: name.trim() })
    .select()
    .single();
  if (error) return json({ error: error.message }, 500);

  const trialEnds = new Date(Date.now() + 14 * 86400_000).toISOString();
  const { error: subErr } = await gate.admin
    .from('subscriptions')
    .insert({ clinic_id: clinic.id, status: 'trialing', trial_ends_at: trialEnds });
  if (subErr) return json({ error: subErr.message }, 500);

  return json({ clinic }, 200);
});
```

- [ ] **Step 4: Serve functions locally + smoke-test create-clinic**

In a terminal, run: `npx supabase functions serve` (leave running; it serves everything in `supabase/functions/` with the auto-injected env). Keep the main stack up (`npx supabase start`).

Get a super-admin JWT for testing. In the browser (app running, signed in as `ulysses.feria@gmail.com`), open devtools console and run `JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.includes('auth-token')))).access_token` — copy the token. (Or use Supabase Studio → the SQL editor is not enough; the browser token is simplest.)

Then:

```bash
curl -s -X POST http://127.0.0.1:54321/functions/v1/create-clinic \
  -H "Authorization: Bearer <SUPER_ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Clinic A"}'
```
Expected: `{"clinic":{"id":"...","name":"Test Clinic A",...}}`. Verify in Studio that the clinic + a `trialing` subscription (trial_ends_at ≈ now+14d) exist.

Smoke the auth gate:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:54321/functions/v1/create-clinic -H "Content-Type: application/json" -d '{"name":"x"}'
```
Expected: `401` (no JWT).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/cors.ts supabase/functions/_shared/auth.ts supabase/functions/create-clinic/index.ts
git commit -m "feat(admin): create-clinic edge function + shared cors/auth helpers"
```

---

### Task 3: add-members edge function

**Files:**
- Create: `supabase/functions/add-members/index.ts`

**Interfaces:**
- Consumes: `requireSuperAdmin`, cors helpers.
- Produces: `add-members` — body `{ clinic_id, emails: string[], role: 'clinic_admin'|'staff' }` → `{ inserted: string[], skipped: string[] }`.

- [ ] **Step 1: Write add-members**

Create `supabase/functions/add-members/index.ts`:

```ts
import { handleCors, json } from '../_shared/cors.ts';
import { requireSuperAdmin } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const gate = await requireSuperAdmin(req);
  if ('error' in gate) return json({ error: gate.error }, gate.status);

  let body: { clinic_id?: string; emails?: string[]; role?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  const { clinic_id, emails, role = 'staff' } = body;
  if (!clinic_id) return json({ error: 'clinic_id is required' }, 400);
  if (!Array.isArray(emails) || emails.length === 0) return json({ error: 'emails required' }, 400);
  if (role !== 'clinic_admin' && role !== 'staff') return json({ error: 'invalid role' }, 400);

  // Normalize + de-dup within the request.
  const clean = [...new Set(emails.map(e => e.trim().toLowerCase()).filter(Boolean))];

  // Which already exist anywhere (email is globally unique)?
  const { data: existing } = await gate.admin
    .from('memberships')
    .select('email')
    .in('email', clean);
  const taken = new Set((existing ?? []).map((r: { email: string }) => r.email));

  const toInsert = clean.filter(e => !taken.has(e));
  const skipped = clean.filter(e => taken.has(e));

  if (toInsert.length) {
    const rows = toInsert.map(email => ({ clinic_id, email, role }));
    const { error } = await gate.admin.from('memberships').insert(rows);
    if (error) return json({ error: error.message }, 500);
  }

  return json({ inserted: toInsert, skipped }, 200);
});
```

- [ ] **Step 2: Smoke-test add-members**

With `functions serve` running and a super-admin JWT + a clinic id (from Task 2):

```bash
curl -s -X POST http://127.0.0.1:54321/functions/v1/add-members \
  -H "Authorization: Bearer <SUPER_ADMIN_JWT>" -H "Content-Type: application/json" \
  -d '{"clinic_id":"<CLINIC_ID>","emails":["a@x.com","A@x.com","b@x.com"],"role":"staff"}'
```
Expected: `{"inserted":["a@x.com","b@x.com"],"skipped":[]}` (the duplicate `A@x.com` collapses to one). Re-run the same command → now `{"inserted":[],"skipped":["a@x.com","b@x.com"]}`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/add-members/index.ts
git commit -m "feat(admin): add-members edge function (bulk seed staff emails)"
```

---

### Task 4: set-subscription + expire-clinic edge functions

**Files:**
- Create: `supabase/functions/set-subscription/index.ts`
- Create: `supabase/functions/expire-clinic/index.ts`

**Interfaces:**
- Consumes: `requireSuperAdmin`, cors helpers.
- Produces: `set-subscription` — body `{ clinic_id, months? }` (default 1) → sets `status='active'`, `active_until = max(now, active_until) + months*30d`, returns `{ subscription }`. `expire-clinic` — body `{ clinic_id }` → `status='expired'`, returns `{ subscription }`.

- [ ] **Step 1: Write set-subscription**

Create `supabase/functions/set-subscription/index.ts`:

```ts
import { handleCors, json } from '../_shared/cors.ts';
import { requireSuperAdmin } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const gate = await requireSuperAdmin(req);
  if ('error' in gate) return json({ error: gate.error }, gate.status);

  let body: { clinic_id?: string; months?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  const { clinic_id, months = 1 } = body;
  if (!clinic_id) return json({ error: 'clinic_id is required' }, 400);
  if (!Number.isFinite(months) || months < 1) return json({ error: 'invalid months' }, 400);

  const { data: current } = await gate.admin
    .from('subscriptions')
    .select('active_until')
    .eq('clinic_id', clinic_id)
    .maybeSingle();

  const now = Date.now();
  const base = current?.active_until ? Math.max(now, new Date(current.active_until).getTime()) : now;
  const activeUntil = new Date(base + months * 30 * 86400_000).toISOString();

  const { data: sub, error } = await gate.admin
    .from('subscriptions')
    .update({ status: 'active', active_until: activeUntil, updated_at: new Date().toISOString(), updated_by: gate.userId })
    .eq('clinic_id', clinic_id)
    .select()
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ subscription: sub }, 200);
});
```

- [ ] **Step 2: Write expire-clinic**

Create `supabase/functions/expire-clinic/index.ts`:

```ts
import { handleCors, json } from '../_shared/cors.ts';
import { requireSuperAdmin } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const gate = await requireSuperAdmin(req);
  if ('error' in gate) return json({ error: gate.error }, gate.status);

  let clinic_id: string;
  try {
    clinic_id = (await req.json()).clinic_id;
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  if (!clinic_id) return json({ error: 'clinic_id is required' }, 400);

  const { data: sub, error } = await gate.admin
    .from('subscriptions')
    .update({ status: 'expired', updated_at: new Date().toISOString(), updated_by: gate.userId })
    .eq('clinic_id', clinic_id)
    .select()
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ subscription: sub }, 200);
});
```

- [ ] **Step 3: Smoke-test both**

With `functions serve` running + super-admin JWT + a clinic id:

```bash
curl -s -X POST http://127.0.0.1:54321/functions/v1/set-subscription \
  -H "Authorization: Bearer <JWT>" -H "Content-Type: application/json" \
  -d '{"clinic_id":"<CLINIC_ID>","months":1}'
```
Expected: `{"subscription":{"status":"active","active_until":"<~30d out>",...}}`. Run again → `active_until` extends by another ~30d (additive).

```bash
curl -s -X POST http://127.0.0.1:54321/functions/v1/expire-clinic \
  -H "Authorization: Bearer <JWT>" -H "Content-Type: application/json" -d '{"clinic_id":"<CLINIC_ID>"}'
```
Expected: `{"subscription":{"status":"expired",...}}`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/set-subscription/index.ts supabase/functions/expire-clinic/index.ts
git commit -m "feat(admin): set-subscription (additive renew) + expire-clinic edge functions"
```

---

### Task 5: Admin data service (reads + function invokers)

**Files:**
- Create: `src/app/features/admin/admin.store.ts`
- Create: `src/app/features/admin/admin.model.ts`
- Create: `src/app/features/admin/admin.store.spec.ts`

**Interfaces:**
- Consumes: `SUPABASE`.
- Produces: `AdminStore` with `clinics` (resource of `AdminClinic[]`), `reload()`, `isLoading`/`error`, and async methods `createClinic(name)`, `addMembers(clinicId, emails[], role)`, `activate(clinicId, months)`, `expire(clinicId)` (each calls `supabase.functions.invoke` and reloads); plus `members(clinicId)` loader. `AdminClinic = { id, name, createdAt, status, trialEndsAt, activeUntil, memberCount }`.

- [ ] **Step 1: Write the model**

Create `src/app/features/admin/admin.model.ts`:

```ts
export interface AdminClinic {
  id: string;
  name: string;
  createdAt: string;
  status: 'trialing' | 'active' | 'expired';
  trialEndsAt: string | null;
  activeUntil: string | null;
  memberCount: number;
}

export interface AdminMember {
  id: string;
  email: string;
  role: 'clinic_admin' | 'staff';
  bound: boolean;
}
```

- [ ] **Step 2: Write the store spec (failing)**

Create `src/app/features/admin/admin.store.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { AdminStore } from './admin.store';
import { SUPABASE } from '../../core/supabase.client';
import { vi } from 'vitest';

const clinicRows = [
  {
    id: 'c1', name: 'Demo Clinic', created_at: '2026-07-01T00:00:00Z',
    subscriptions: { status: 'trialing', trial_ends_at: '2026-07-15T00:00:00Z', active_until: null },
    memberships: [{ count: 3 }],
  },
];

function makeClient(invoke = vi.fn().mockResolvedValue({ data: {}, error: null })) {
  return {
    functions: { invoke },
    from: vi.fn(() => ({
      select: () => ({ order: () => Promise.resolve({ data: clinicRows, error: null }) }),
    })),
  };
}

describe('AdminStore', () => {
  function setup(client: unknown) {
    TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
    return TestBed.inject(AdminStore);
  }

  it('loads clinics and maps subscription + member count', async () => {
    const store = setup(makeClient());
    await new Promise(r => setTimeout(r));
    const c = store.clinics()[0];
    expect(c.name).toBe('Demo Clinic');
    expect(c.status).toBe('trialing');
    expect(c.memberCount).toBe(3);
  });

  it('createClinic invokes the edge function then reloads', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { clinic: { id: 'c2' } }, error: null });
    const store = setup(makeClient(invoke));
    await new Promise(r => setTimeout(r));
    await store.createClinic('New Clinic');
    expect(invoke).toHaveBeenCalledWith('create-clinic', { body: { name: 'New Clinic' } });
  });

  it('activate invokes set-subscription with months', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { subscription: {} }, error: null });
    const store = setup(makeClient(invoke));
    await new Promise(r => setTimeout(r));
    await store.activate('c1', 1);
    expect(invoke).toHaveBeenCalledWith('set-subscription', { body: { clinic_id: 'c1', months: 1 } });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx ng test --include="src/app/features/admin/admin.store.spec.ts" --watch=false`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the store**

Create `src/app/features/admin/admin.store.ts`:

```ts
import { computed, inject, resource, Service } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { AdminClinic, AdminMember } from './admin.model';

@Service()
export class AdminStore {
  private supabase = inject(SUPABASE);

  private clinicsResource = resource({
    loader: async () => {
      const { data, error } = await this.supabase
        .from('clinics')
        .select('id, name, created_at, subscriptions(status, trial_ends_at, active_until), memberships(count)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row: any): AdminClinic => {
        const sub = Array.isArray(row.subscriptions) ? row.subscriptions[0] : row.subscriptions;
        const count = Array.isArray(row.memberships) ? (row.memberships[0]?.count ?? 0) : 0;
        return {
          id: row.id,
          name: row.name,
          createdAt: row.created_at,
          status: sub?.status ?? 'expired',
          trialEndsAt: sub?.trial_ends_at ?? null,
          activeUntil: sub?.active_until ?? null,
          memberCount: count,
        };
      });
    },
  });

  clinics = computed<AdminClinic[]>(() => this.clinicsResource.value() ?? []);
  readonly isLoading = computed(() => this.clinicsResource.isLoading());
  readonly error = computed(() => this.clinicsResource.error());
  reload() { this.clinicsResource.reload(); }

  private async invoke(name: string, body: unknown): Promise<void> {
    const { error } = await this.supabase.functions.invoke(name, { body });
    if (error) throw error;
    this.clinicsResource.reload();
  }

  createClinic(name: string) { return this.invoke('create-clinic', { name }); }
  addMembers(clinicId: string, emails: string[], role: 'clinic_admin' | 'staff') {
    return this.invoke('add-members', { clinic_id: clinicId, emails, role });
  }
  activate(clinicId: string, months = 1) { return this.invoke('set-subscription', { clinic_id: clinicId, months }); }
  expire(clinicId: string) { return this.invoke('expire-clinic', { clinic_id: clinicId }); }

  /** Members of one clinic (super-admin RLS returns them). */
  async members(clinicId: string): Promise<AdminMember[]> {
    const { data } = await this.supabase
      .from('memberships')
      .select('id, email, role, user_id')
      .eq('clinic_id', clinicId)
      .order('email');
    return ((data as any[]) ?? []).map(r => ({ id: r.id, email: r.email, role: r.role, bound: r.user_id !== null }));
  }
}
```

Note: `addMembers` here wraps the body as `{ clinic_id, emails, role }` — but `invoke()` above wraps its second arg as the function body. Confirm the spec's expected `invoke` calls match: `createClinic` → `invoke('create-clinic', { body: { name } })`. So `invoke(name, body)` must call `this.supabase.functions.invoke(name, { body })`. The code above does exactly that.

- [ ] **Step 5: Run the store spec (passes) + build**

Run: `npx ng test --include="src/app/features/admin/admin.store.spec.ts" --watch=false`
Expected: PASS (3 tests).
Run: `npx ng build` → no TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/features/admin/admin.store.ts src/app/features/admin/admin.model.ts src/app/features/admin/admin.store.spec.ts
git commit -m "feat(admin): admin store (clinic reads + edge-function invokers)"
```

---

### Task 6: Admin UI — clinics list, create, and clinic detail

**Files:**
- Create: `src/app/features/admin/admin-clinics.component.ts`
- Create: `src/app/features/admin/admin-clinic-detail.component.ts`
- Modify: `src/app/app.routes.ts`

**Interfaces:**
- Consumes: `AdminStore` (Task 5), `superAdminGuard` (Task 1).
- Produces: `/admin` (clinics list + create form) and `/admin/:id` (clinic detail: members, add-members form, activate/renew) routes under `[authGuard, superAdminGuard]`.

- [ ] **Step 1: Create the clinics list + create component**

Create `src/app/features/admin/admin-clinics.component.ts`:

```ts
import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { AdminStore } from './admin.store';

@Component({
  selector: 'app-admin-clinics',
  imports: [DatePipe, RouterLink, MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatProgressBarModule],
  template: `
    <header class="head">
      <h1>Clinics</h1>
    </header>

    <mat-card appearance="outlined" class="create">
      <form (submit)="$event.preventDefault(); create()">
        <mat-form-field appearance="outline">
          <mat-label>New clinic name</mat-label>
          <input matInput [value]="name()" (input)="name.set($any($event.target).value)" />
        </mat-form-field>
        <button mat-flat-button type="submit" [disabled]="!name().trim() || busy()">Create</button>
      </form>
      @if (createError()) { <div class="err">{{ createError() }}</div> }
    </mat-card>

    @if (store.isLoading()) { <mat-progress-bar mode="indeterminate" /> }

    <div class="grid">
      @for (c of store.clinics(); track c.id) {
        <mat-card appearance="outlined" class="clinic">
          <a [routerLink]="[c.id]" class="clinic-name">{{ c.name }}</a>
          <span class="badge" [class.trial]="c.status === 'trialing'" [class.expired]="c.status === 'expired'">{{ c.status }}</span>
          <p class="meta">
            @if (c.status === 'trialing') { Trial ends {{ c.trialEndsAt | date: 'mediumDate' }} }
            @else if (c.status === 'active') { Active until {{ c.activeUntil | date: 'mediumDate' }} }
            @else { No active subscription }
          </p>
          <p class="meta">{{ c.memberCount }} member(s)</p>
        </mat-card>
      }
    </div>
  `,
  styles: `
    .head h1 { font: var(--mat-sys-headline-small); margin: 0 0 1rem; }
    .create form { display: flex; gap: 0.75rem; align-items: baseline; padding: 0.5rem; }
    .create mat-form-field { flex: 1; }
    .err { color: var(--mat-sys-error); padding: 0 0.5rem 0.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); gap: 1rem; margin-top: 1rem; }
    .clinic { display: flex; flex-direction: column; gap: 0.35rem; padding: 1rem; }
    .clinic-name { font: var(--mat-sys-title-medium); color: var(--mat-sys-primary); text-decoration: none; }
    .badge { align-self: flex-start; padding: 0.1rem 0.55rem; border-radius: 1rem; font: var(--mat-sys-label-small);
      background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); text-transform: capitalize; }
    .badge.trial { background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container); }
    .badge.expired { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .meta { margin: 0; color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); }
  `,
})
export class AdminClinicsComponent {
  protected store = inject(AdminStore);
  protected name = signal('');
  protected busy = signal(false);
  protected createError = signal<string | null>(null);

  async create() {
    if (!this.name().trim()) return;
    this.busy.set(true);
    this.createError.set(null);
    try {
      await this.store.createClinic(this.name().trim());
      this.name.set('');
    } catch {
      this.createError.set("Couldn't create the clinic.");
    } finally {
      this.busy.set(false);
    }
  }
}
```

- [ ] **Step 2: Create the clinic detail component**

Create `src/app/features/admin/admin-clinic-detail.component.ts`:

```ts
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AdminStore } from './admin.store';
import { AdminClinic, AdminMember } from './admin.model';

@Component({
  selector: 'app-admin-clinic-detail',
  imports: [DatePipe, RouterLink, MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <header class="head">
      <a mat-icon-button routerLink="/admin" aria-label="Back"><mat-icon>arrow_back</mat-icon></a>
      <h1>{{ clinic()?.name ?? 'Clinic' }}</h1>
    </header>

    @if (clinic(); as c) {
      <mat-card appearance="outlined" class="section">
        <h2>Subscription</h2>
        <p class="meta">
          Status: <strong>{{ c.status }}</strong>
          @if (c.status === 'trialing') { · trial ends {{ c.trialEndsAt | date: 'mediumDate' }} }
          @else if (c.status === 'active') { · active until {{ c.activeUntil | date: 'mediumDate' }} }
        </p>
        <div class="actions">
          <button mat-flat-button (click)="activate()" [disabled]="busy()">Activate / +1 month</button>
          <button mat-stroked-button (click)="expire()" [disabled]="busy()">Expire</button>
        </div>
        @if (actionError()) { <div class="err">{{ actionError() }}</div> }
      </mat-card>
    }

    <mat-card appearance="outlined" class="section">
      <h2>Add members</h2>
      <mat-form-field appearance="outline" class="wide">
        <mat-label>Emails (one per line)</mat-label>
        <textarea matInput rows="4" [value]="emails()" (input)="emails.set($any($event.target).value)"></textarea>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Role</mat-label>
        <mat-select [value]="role()" (valueChange)="role.set($event)">
          <mat-option value="staff">staff</mat-option>
          <mat-option value="clinic_admin">clinic_admin</mat-option>
        </mat-select>
      </mat-form-field>
      <button mat-flat-button (click)="add()" [disabled]="!emails().trim() || busy()">Add</button>
      @if (addResult()) { <div class="ok">{{ addResult() }}</div> }
    </mat-card>

    <mat-card appearance="outlined" class="section">
      <h2>Members</h2>
      @for (m of members(); track m.id) {
        <div class="member">
          <span>{{ m.email }}</span>
          <span class="role">{{ m.role }}</span>
          <span class="bound" [class.yes]="m.bound">{{ m.bound ? 'active' : 'invited' }}</span>
        </div>
      } @empty { <p class="meta">No members yet.</p> }
    </mat-card>
  `,
  styles: `
    .head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; }
    .head h1 { font: var(--mat-sys-headline-small); margin: 0; }
    .section { padding: 1rem; margin-bottom: 1rem; }
    .section h2 { font: var(--mat-sys-title-medium); margin: 0 0 0.75rem; }
    .wide { width: 100%; }
    .actions { display: flex; gap: 0.5rem; }
    .meta { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); }
    .err { color: var(--mat-sys-error); margin-top: 0.5rem; }
    .ok { color: var(--mat-sys-primary); margin-top: 0.5rem; }
    .member { display: flex; gap: 1rem; align-items: center; padding: 0.35rem 0; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .member .role { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); }
    .member .bound { margin-left: auto; padding: 0.1rem 0.5rem; border-radius: 1rem; font: var(--mat-sys-label-small);
      background: var(--mat-sys-secondary-container); }
    .member .bound.yes { background: var(--mat-sys-tertiary-container); }
  `,
})
export class AdminClinicDetailComponent {
  protected store = inject(AdminStore);
  id = input.required<string>();

  protected clinic = computed<AdminClinic | undefined>(() => this.store.clinics().find(c => c.id === this.id()));
  protected members = signal<AdminMember[]>([]);
  protected emails = signal('');
  protected role = signal<'staff' | 'clinic_admin'>('staff');
  protected busy = signal(false);
  protected actionError = signal<string | null>(null);
  protected addResult = signal<string | null>(null);

  constructor() {
    // Ensure the clinics list is loaded (so `clinic()` resolves on deep-link) and load members.
    effect(() => {
      const id = this.id();
      if (id) this.loadMembers(id);
    });
  }

  private async loadMembers(id: string) {
    this.members.set(await this.store.members(id));
  }

  private parseEmails(): string[] {
    return this.emails().split(/[\n,]/).map(e => e.trim()).filter(Boolean);
  }

  async activate() {
    this.busy.set(true); this.actionError.set(null);
    try { await this.store.activate(this.id(), 1); } catch { this.actionError.set("Action failed."); }
    finally { this.busy.set(false); }
  }

  async expire() {
    this.busy.set(true); this.actionError.set(null);
    try { await this.store.expire(this.id()); } catch { this.actionError.set("Action failed."); }
    finally { this.busy.set(false); }
  }

  async add() {
    const list = this.parseEmails();
    if (!list.length) return;
    this.busy.set(true); this.addResult.set(null);
    try {
      await this.store.addMembers(this.id(), list, this.role());
      this.emails.set('');
      await this.loadMembers(this.id());
      this.addResult.set('Members added.');
    } catch {
      this.addResult.set('Failed to add members.');
    } finally {
      this.busy.set(false);
    }
  }
}
```

- [ ] **Step 3: Wire the admin routes**

In `src/app/app.routes.ts`, add the `superAdminGuard` import and an `/admin` route group after the `blocked` route:

```ts
import { superAdminGuard } from './core/auth/super-admin.guard';
```

```ts
{
  path: 'admin',
  canActivate: [authGuard, superAdminGuard],
  children: [
    { path: '', loadComponent: () => import('./features/admin/admin-clinics.component').then(m => m.AdminClinicsComponent) },
    { path: ':id', loadComponent: () => import('./features/admin/admin-clinic-detail.component').then(m => m.AdminClinicDetailComponent) },
  ],
},
```

Note: `AdminClinicDetailComponent` uses `input.required('id')` bound from the route param via `withComponentInputBinding()` (already enabled in `app.config.ts`).

- [ ] **Step 4: Verify + Playwright + build**

Run: `npx ng build` → no TS errors (lazy admin imports resolve).
Run: `npx ng test --watch=false` → full suite green.
Playwright: load http://localhost:4200 → renders, 0 console errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/admin/admin-clinics.component.ts src/app/features/admin/admin-clinic-detail.component.ts src/app/app.routes.ts
git commit -m "feat(admin): super-admin clinics list, create, and clinic detail UI"
```

---

### Task 7: End-to-end verification + config

**Files:**
- Modify: `README.md` (document the admin area + `functions serve`)

**Interfaces:**
- Consumes: everything above.
- Produces: a documented, working super-admin flow.

- [ ] **Step 1: Full manual E2E (super-admin)**

Ensure `npx supabase start` and `npx supabase functions serve` are both running, and the app (`npm start`). Sign in as `ulysses.feria@gmail.com` (a super-admin). Then:
1. Toolbar shows an **Admin** link → click it → `/admin` lists clinics (Demo Clinic + any test clinics).
2. **Create clinic:** enter a name → Create → the new clinic appears with a `trialing` badge and "Trial ends <date ~14d>".
3. Open the new clinic → **Add members:** paste two emails (one per line), pick a role, Add → they appear under Members as "invited" (unbound). Re-add one → it's skipped (no duplicate).
4. **Activate:** click "Activate / +1 month" → status flips to `active`, "active until <~30d>". Click again → the date extends by another month.
5. **Expire:** click Expire → status `expired`. Then sign in (separate browser/profile) as one of the invited emails for that clinic → confirm `/blocked` (Phase 4). Re-activate to restore.
6. **Non-super-admin:** sign in as a normal clinic user → no Admin link; manually visiting `/admin` redirects to `/dashboard`.

Record pass/fail per step in the task report. Use Playwright to drive at least steps 1-2 (navigate to /admin, snapshot, assert the clinics render, 0 console errors).

- [ ] **Step 2: Document in README**

Add an "Admin area (super-admin)" subsection under the Backend section of `README.md`:

```markdown
### Admin area (super-admin)

Privileged actions (create clinic, add members, activate/expire subscription) run
as Supabase Edge Functions. Run them locally alongside the stack:

    npx supabase functions serve   # serves supabase/functions/*

A user listed in the `super_admins` table sees an **Admin** link in the toolbar
(`/admin`): create clinics, bulk-add staff emails, and activate/renew or expire a
clinic's subscription. Reads use RLS (super-admins can read all rows); writes go
through the gated edge functions.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the super-admin area and edge functions"
```

---

## Phase 5 Done — Definition of Done

- `npx ng test --watch=false` + `npx ng build` green; app renders in Playwright with no console errors.
- Edge functions `create-clinic`, `add-members`, `set-subscription`, `expire-clinic` work locally and reject non-super-admins (403) and anonymous calls (401).
- A super-admin can, entirely in-app: create a clinic (trial auto-set), bulk-add staff emails (deduped), and activate/renew/expire subscriptions — no more Supabase Studio edits.
- A non-super-admin sees no Admin link and cannot reach `/admin`.

## Notes for Later / Out of Scope

- Automated tests for the Deno edge functions are not included — they are covered by curl smoke tests + the manual E2E. A future task could add `deno test` with mocked clients.
- Hosted deployment: the edge functions deploy via `supabase functions deploy`; the Google provider + `super_admins` seed + a production `environment.ts` are configured per-environment then.
- Multi-staff self-service invites and real payment processing remain out of scope for this milestone.
