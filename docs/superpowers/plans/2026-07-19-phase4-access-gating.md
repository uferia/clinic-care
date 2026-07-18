# Phase 4 — Access Gating (membership + subscription screens) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the membership/subscription access UX: after login, resolve the user's clinic + subscription state and route them to the app, a "no access" screen (email on no clinic), or a "subscription blocked" screen (trial/plan ended) — plus a plan badge in the toolbar.

**Architecture:** A root `ClinicContextService` loads the current user's membership + subscription once at startup (chained after auth in `provideAppInitializer`) and exposes signals (`hasClinic`, `isActive`, `status`, `daysLeft`, …). A synchronous `accessGuard` reads those signals and redirects to `/no-access` or `/blocked` as needed; it sits alongside the existing `authGuard` on the app routes. Two standalone screens render the blocked states, and the toolbar shows a trial/active badge. RLS already returns empty data for expired/unlinked users — this phase makes that state legible instead of a silently empty app.

**Tech Stack:** Angular 22 (standalone, signals, functional guards), `@supabase/supabase-js`, Angular Material, Vitest + jsdom.

## Global Constraints

- The clinic/subscription state is read via the injected `SUPABASE` client. RLS lets a member read their own clinic + subscription rows even when the subscription is expired (so the blocked screen can explain why).
- "Active" = `(status='trialing' AND trial_ends_at > now)` OR `(status='active' AND active_until > now)` — the same predicate the DB's `current_clinic_active()` uses. Compute it client-side from the subscription row for display; the DB remains the real enforcement (RLS).
- The context loads before the first guarded navigation (chained in `provideAppInitializer` after `AuthService.initialize()`), so `accessGuard` can decide synchronously.
- Do NOT change the data layer or auth flow beyond wiring the context load + guard. Feature stores/forms are untouched.
- Tests: `npx ng test --include="<spec>" --watch=false` (full suite `npx ng test --watch=false`), run from **PowerShell** on this Windows box. **Every task verifies with BOTH `npx ng test --watch=false` AND `npx ng build`** — `ng test` does not typecheck the whole app.
- Commits carry NO `Co-Authored-By:` / Anthropic / Claude trailer — repo default author only.

---

### Task 1: ClinicContextService

**Files:**
- Create: `src/app/core/clinic/clinic-context.service.ts`
- Create: `src/app/core/clinic/clinic-context.service.spec.ts`

**Interfaces:**
- Consumes: `SUPABASE` token.
- Produces `ClinicContextService`:
  - `readonly access: Signal<ClinicAccess | null>` where `ClinicAccess = { clinicId: string; clinicName: string; status: 'trialing'|'active'|'expired'; trialEndsAt: string | null; activeUntil: string | null }`
  - `readonly ready: Signal<boolean>`
  - `readonly hasClinic: Signal<boolean>`
  - `readonly isActive: Signal<boolean>`
  - `readonly daysLeft: Signal<number | null>` — whole days until trial/active expiry (null when not applicable)
  - `load(): Promise<void>` — resolves membership → clinic → subscription; sets `access` + `ready`
  - `clear(): void` — resets to signed-out state

- [ ] **Step 1: Write the failing test**

Create `src/app/core/clinic/clinic-context.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { ClinicContextService } from './clinic-context.service';
import { SUPABASE } from '../supabase.client';
import { vi } from 'vitest';

/** Minimal supabase stub: getUser + two table queries (memberships, subscriptions). */
function makeClient(opts: {
  userId?: string | null;
  membership?: { clinic_id: string; clinics: { name: string } } | null;
  subscription?: { status: string; trial_ends_at: string | null; active_until: string | null } | null;
}) {
  const maybeSingle = (row: unknown) => ({
    eq: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }),
  });
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: opts.userId ? { id: opts.userId } : null }, error: null }) },
    from: vi.fn((table: string) => ({
      select: () => (table === 'memberships' ? maybeSingle(opts.membership ?? null) : maybeSingle(opts.subscription ?? null)),
    })),
  };
}

function setup(client: unknown) {
  TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
  return TestBed.inject(ClinicContextService);
}

describe('ClinicContextService', () => {
  it('has no clinic when the user has no membership', async () => {
    const svc = setup(makeClient({ userId: 'u1', membership: null }));
    await svc.load();
    expect(svc.ready()).toBe(true);
    expect(svc.hasClinic()).toBe(false);
    expect(svc.isActive()).toBe(false);
  });

  it('is active during a live trial and reports days left', async () => {
    const future = new Date(Date.now() + 5 * 86400_000).toISOString();
    const svc = setup(makeClient({
      userId: 'u1',
      membership: { clinic_id: 'c1', clinics: { name: 'Demo Clinic' } },
      subscription: { status: 'trialing', trial_ends_at: future, active_until: null },
    }));
    await svc.load();
    expect(svc.hasClinic()).toBe(true);
    expect(svc.isActive()).toBe(true);
    expect(svc.access()?.clinicName).toBe('Demo Clinic');
    expect(svc.daysLeft()).toBe(5);
  });

  it('is not active when the trial has ended', async () => {
    const past = new Date(Date.now() - 86400_000).toISOString();
    const svc = setup(makeClient({
      userId: 'u1',
      membership: { clinic_id: 'c1', clinics: { name: 'Demo Clinic' } },
      subscription: { status: 'trialing', trial_ends_at: past, active_until: null },
    }));
    await svc.load();
    expect(svc.hasClinic()).toBe(true);
    expect(svc.isActive()).toBe(false);
  });

  it('is active on a paid plan until active_until', async () => {
    const future = new Date(Date.now() + 20 * 86400_000).toISOString();
    const svc = setup(makeClient({
      userId: 'u1',
      membership: { clinic_id: 'c1', clinics: { name: 'Demo Clinic' } },
      subscription: { status: 'active', trial_ends_at: '2020-01-01T00:00:00Z', active_until: future },
    }));
    await svc.load();
    expect(svc.isActive()).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx ng test --include="src/app/core/clinic/clinic-context.service.spec.ts" --watch=false`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `src/app/core/clinic/clinic-context.service.ts`:

```ts
import { Injectable, computed, inject, signal } from '@angular/core';
import { SUPABASE } from '../supabase.client';

export interface ClinicAccess {
  clinicId: string;
  clinicName: string;
  status: 'trialing' | 'active' | 'expired';
  trialEndsAt: string | null;
  activeUntil: string | null;
}

@Injectable({ providedIn: 'root' })
export class ClinicContextService {
  private supabase = inject(SUPABASE);

  readonly access = signal<ClinicAccess | null>(null);
  readonly ready = signal(false);

  readonly hasClinic = computed(() => this.access() !== null);

  readonly isActive = computed(() => {
    const a = this.access();
    if (!a) return false;
    const now = Date.now();
    if (a.status === 'trialing' && a.trialEndsAt) return new Date(a.trialEndsAt).getTime() > now;
    if (a.status === 'active' && a.activeUntil) return new Date(a.activeUntil).getTime() > now;
    return false;
  });

  /** Whole days until the relevant expiry, or null when nothing applies. */
  readonly daysLeft = computed(() => {
    const a = this.access();
    if (!a) return null;
    const target = a.status === 'trialing' ? a.trialEndsAt : a.status === 'active' ? a.activeUntil : null;
    if (!target) return null;
    const ms = new Date(target).getTime() - Date.now();
    return ms <= 0 ? 0 : Math.ceil(ms / 86400_000);
  });

  async load(): Promise<void> {
    try {
      const { data: userData } = await this.supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) {
        this.access.set(null);
        return;
      }
      const { data: membership } = await this.supabase
        .from('memberships')
        .select('clinic_id, clinics(name)')
        .eq('user_id', uid)
        .maybeSingle();
      if (!membership) {
        this.access.set(null);
        return;
      }
      const clinic = (membership as any).clinics;
      const clinicName = Array.isArray(clinic) ? clinic[0]?.name : clinic?.name;
      const { data: sub } = await this.supabase
        .from('subscriptions')
        .select('status, trial_ends_at, active_until')
        .eq('clinic_id', (membership as any).clinic_id)
        .maybeSingle();
      this.access.set({
        clinicId: (membership as any).clinic_id,
        clinicName: clinicName ?? 'Your clinic',
        status: ((sub as any)?.status ?? 'expired') as ClinicAccess['status'],
        trialEndsAt: (sub as any)?.trial_ends_at ?? null,
        activeUntil: (sub as any)?.active_until ?? null,
      });
    } catch {
      this.access.set(null);
    } finally {
      this.ready.set(true);
    }
  }

  clear(): void {
    this.access.set(null);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx ng test --include="src/app/core/clinic/clinic-context.service.spec.ts" --watch=false`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify build + commit**

Run: `npx ng build` → no TS errors.

```bash
git add src/app/core/clinic/clinic-context.service.ts src/app/core/clinic/clinic-context.service.spec.ts
git commit -m "feat(access): clinic context service (membership + subscription state)"
```

---

### Task 2: accessGuard + load context at startup

**Files:**
- Create: `src/app/core/auth/access.guard.ts`
- Create: `src/app/core/auth/access.guard.spec.ts`
- Modify: `src/app/app.config.ts`

**Interfaces:**
- Consumes: `ClinicContextService` (Task 1), `AuthService`.
- Produces: `accessGuard: CanActivateFn` — `!hasClinic` → `/no-access`; `hasClinic && !isActive` → `/blocked`; else `true`. Context is loaded in `provideAppInitializer` after `AuthService.initialize()`.

- [ ] **Step 1: Write the failing test**

Create `src/app/core/auth/access.guard.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { RouterStateSnapshot, ActivatedRouteSnapshot, UrlTree, provideRouter } from '@angular/router';
import { accessGuard } from './access.guard';
import { ClinicContextService } from '../clinic/clinic-context.service';
import { SUPABASE } from '../supabase.client';

function run() {
  const state = { url: '/patients' } as RouterStateSnapshot;
  const route = {} as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(() => accessGuard(route, state));
}

describe('accessGuard', () => {
  function configure() {
    const client = { auth: {}, from: () => ({}) };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SUPABASE, useValue: client }],
    });
    return TestBed.inject(ClinicContextService);
  }

  it('redirects to /no-access when the user has no clinic', () => {
    const ctx = configure();
    ctx.access.set(null);
    const r = run();
    expect(r).toBeInstanceOf(UrlTree);
    expect((r as UrlTree).toString()).toContain('/no-access');
  });

  it('redirects to /blocked when the clinic subscription is not active', () => {
    const ctx = configure();
    ctx.access.set({ clinicId: 'c1', clinicName: 'X', status: 'trialing', trialEndsAt: '2020-01-01T00:00:00Z', activeUntil: null });
    const r = run();
    expect(r).toBeInstanceOf(UrlTree);
    expect((r as UrlTree).toString()).toContain('/blocked');
  });

  it('allows navigation for an active clinic', () => {
    const ctx = configure();
    const future = new Date(Date.now() + 86400_000).toISOString();
    ctx.access.set({ clinicId: 'c1', clinicName: 'X', status: 'trialing', trialEndsAt: future, activeUntil: null });
    expect(run()).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx ng test --include="src/app/core/auth/access.guard.spec.ts" --watch=false`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the guard**

Create `src/app/core/auth/access.guard.ts`:

```ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ClinicContextService } from '../clinic/clinic-context.service';

export const accessGuard: CanActivateFn = () => {
  const ctx = inject(ClinicContextService);
  const router = inject(Router);
  if (!ctx.hasClinic()) return router.createUrlTree(['/no-access']);
  if (!ctx.isActive()) return router.createUrlTree(['/blocked']);
  return true;
};
```

- [ ] **Step 4: Load the context at startup**

In `src/app/app.config.ts`, replace the `provideAppInitializer(() => inject(AuthService).initialize())` line so it also loads the clinic context after auth:

```ts
provideAppInitializer(async () => {
  await inject(AuthService).initialize();
  await inject(ClinicContextService).load();
}),
```

Add the import: `import { ClinicContextService } from './core/clinic/clinic-context.service';`

- [ ] **Step 5: Run the guard test + build**

Run: `npx ng test --include="src/app/core/auth/access.guard.spec.ts" --watch=false`
Expected: PASS (3 tests).

Run: `npx ng build` → no TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/core/auth/access.guard.ts src/app/core/auth/access.guard.spec.ts src/app/app.config.ts
git commit -m "feat(access): accessGuard and startup context load"
```

---

### Task 3: No-access + Blocked screens and route wiring

**Files:**
- Create: `src/app/features/access/no-access.component.ts`
- Create: `src/app/features/access/blocked.component.ts`
- Modify: `src/app/app.routes.ts`

**Interfaces:**
- Consumes: `ClinicContextService` (Blocked screen shows the subscription state), `accessGuard` (Task 2).
- Produces: `/no-access` and `/blocked` routes (auth-only, NOT access-gated); `accessGuard` added to `dashboard`, `patients`, `doctors`, `appointments`.

- [ ] **Step 1: Create the No-access screen**

Create `src/app/features/access/no-access.component.ts`:

```ts
import { Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-no-access',
  imports: [MatCardModule, MatIconModule, MatButtonModule],
  template: `
    <div class="wrap">
      <mat-card appearance="outlined" class="card">
        <mat-icon class="mark">block</mat-icon>
        <h1>No clinic access</h1>
        <p>Your account isn't linked to a clinic yet. Ask your clinic administrator to add your email, then sign in again.</p>
        <button mat-stroked-button (click)="auth.logout()">
          <mat-icon>logout</mat-icon>
          Sign out
        </button>
      </mat-card>
    </div>
  `,
  styles: `
    .wrap { min-height: 70vh; display: grid; place-items: center; }
    .card { display: flex; flex-direction: column; align-items: center; gap: 0.75rem; padding: 2rem 2.5rem; max-width: 28rem; text-align: center; }
    .mark { color: var(--mat-sys-error); font-size: 2.5rem; width: 2.5rem; height: 2.5rem; }
    h1 { font: var(--mat-sys-headline-small); margin: 0; }
    p { color: var(--mat-sys-on-surface-variant); margin: 0; }
  `,
})
export class NoAccessComponent {
  protected auth = inject(AuthService);
}
```

- [ ] **Step 2: Create the Blocked screen**

Create `src/app/features/access/blocked.component.ts`:

```ts
import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../core/auth/auth.service';
import { ClinicContextService } from '../../core/clinic/clinic-context.service';

@Component({
  selector: 'app-blocked',
  imports: [DatePipe, MatCardModule, MatIconModule, MatButtonModule],
  template: `
    <div class="wrap">
      <mat-card appearance="outlined" class="card">
        <mat-icon class="mark">lock_clock</mat-icon>
        <h1>Subscription needed</h1>
        @if (access(); as a) {
          @if (a.status === 'trialing') {
            <p>Your free trial for <strong>{{ a.clinicName }}</strong> ended
              @if (a.trialEndsAt) { on {{ a.trialEndsAt | date: 'mediumDate' }} }.
              Contact us to activate your subscription.</p>
          } @else {
            <p>The subscription for <strong>{{ a.clinicName }}</strong> has ended
              @if (a.activeUntil) { (expired {{ a.activeUntil | date: 'mediumDate' }}) }.
              Renew to restore access.</p>
          }
        } @else {
          <p>Your clinic's subscription is inactive. Contact us to restore access.</p>
        }
        <button mat-stroked-button (click)="auth.logout()">
          <mat-icon>logout</mat-icon>
          Sign out
        </button>
      </mat-card>
    </div>
  `,
  styles: `
    .wrap { min-height: 70vh; display: grid; place-items: center; }
    .card { display: flex; flex-direction: column; align-items: center; gap: 0.75rem; padding: 2rem 2.5rem; max-width: 30rem; text-align: center; }
    .mark { color: var(--mat-sys-error); font-size: 2.5rem; width: 2.5rem; height: 2.5rem; }
    h1 { font: var(--mat-sys-headline-small); margin: 0; }
    p { color: var(--mat-sys-on-surface-variant); margin: 0; }
  `,
})
export class BlockedComponent {
  protected auth = inject(AuthService);
  private ctx = inject(ClinicContextService);
  protected access = computed(() => this.ctx.access());
}
```

- [ ] **Step 3: Wire the routes**

Edit `src/app/app.routes.ts`. Add the `accessGuard` import, add it after `authGuard` on the four protected route groups, and add the two new routes. Full file:

```ts
import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { accessGuard } from './core/auth/access.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    canActivate: [authGuard, accessGuard],
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login.component').then(m => m.LoginComponent),
  },
  {
    path: 'no-access',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/access/no-access.component').then(m => m.NoAccessComponent),
  },
  {
    path: 'blocked',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/access/blocked.component').then(m => m.BlockedComponent),
  },
  {
    path: 'patients',
    canActivate: [authGuard, accessGuard],
    children: [
      { path: '', loadComponent: () => import('./features/patients/patient-list.component').then(m => m.PatientListComponent) },
      { path: 'new', loadComponent: () => import('./features/patients/patient-form.component').then(m => m.PatientFormComponent) },
      { path: ':id', loadComponent: () => import('./features/patients/patient-form.component').then(m => m.PatientFormComponent) },
    ],
  },
  {
    path: 'doctors',
    canActivate: [authGuard, accessGuard],
    children: [
      { path: '', loadComponent: () => import('./features/doctors/doctor-list.component').then(m => m.DoctorListComponent) },
      { path: 'new', loadComponent: () => import('./features/doctors/doctor-form.component').then(m => m.DoctorFormComponent) },
      { path: ':id', loadComponent: () => import('./features/doctors/doctor-form.component').then(m => m.DoctorFormComponent) },
    ],
  },
  {
    path: 'appointments',
    canActivate: [authGuard, accessGuard],
    children: [
      { path: '', loadComponent: () => import('./features/appointments/appointment-list.component').then(m => m.AppointmentListComponent) },
      { path: 'new', loadComponent: () => import('./features/appointments/appointment-form.component').then(m => m.AppointmentFormComponent) },
      { path: ':id', loadComponent: () => import('./features/appointments/appointment-form.component').then(m => m.AppointmentFormComponent) },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
```

- [ ] **Step 4: Verify build + suite**

Run: `npx ng build` → no TS errors (confirms the lazy component imports resolve).
Run: `npx ng test --watch=false` → full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/access/no-access.component.ts src/app/features/access/blocked.component.ts src/app/app.routes.ts
git commit -m "feat(access): no-access and blocked screens with route gating"
```

---

### Task 4: Toolbar plan badge + clear context on logout

**Files:**
- Modify: `src/app/app.ts`
- Modify: `src/app/app.html`
- Modify: `src/app/core/auth/auth.service.ts`

**Interfaces:**
- Consumes: `ClinicContextService`.
- Produces: a toolbar badge (`Trial · N days left` / `Active until <date>`) shown next to the user; `AuthService.logout()` also clears the clinic context.

- [ ] **Step 1: Clear context on logout**

In `src/app/core/auth/auth.service.ts`, inject `ClinicContextService` and clear it in `logout()`. Add:

```ts
import { ClinicContextService } from '../clinic/clinic-context.service';
```

Add the field `private clinic = inject(ClinicContextService);` and in `logout()`, after `this.user.set(null);`, add `this.clinic.clear();`.

(Guard against a circular import: `ClinicContextService` imports only `SUPABASE`, not `AuthService`, so injecting it into `AuthService` is safe.)

- [ ] **Step 2: Expose badge data on the App component**

In `src/app/app.ts`, inject the context and expose it:

```ts
import { ClinicContextService } from './core/clinic/clinic-context.service';
```

Add the field: `protected clinic = inject(ClinicContextService);`

- [ ] **Step 3: Render the badge in the toolbar**

In `src/app/app.html`, inside the `@if (auth.user(); as user) {` block, immediately before the `<span class="user">` element, add:

```html
@if (clinic.access(); as plan) {
  <span class="plan-badge" [class.trial]="plan.status === 'trialing'">
    @if (plan.status === 'trialing') {
      Trial · {{ clinic.daysLeft() }}d left
    } @else if (plan.status === 'active') {
      Active
    }
  </span>
}
```

Add to the component styles (append to `src/app/app.scss`):

```scss
.plan-badge {
  padding: 0.15rem 0.6rem;
  border-radius: 1rem;
  font: var(--mat-sys-label-small);
  background: var(--mat-sys-secondary-container);
  color: var(--mat-sys-on-secondary-container);
  margin-right: 0.5rem;
  white-space: nowrap;
}
.plan-badge.trial {
  background: var(--mat-sys-tertiary-container);
  color: var(--mat-sys-on-tertiary-container);
}
```

- [ ] **Step 4: Verify build + suite**

Run: `npx ng build` → no TS errors.
Run: `npx ng test --watch=false` → full suite green (existing `app.spec.ts` still passes — with the SUPABASE stub, `clinic.access()` is null so the badge simply doesn't render).

- [ ] **Step 5: Manual end-to-end verification**

With local Supabase running:
1. **Active trial (normal):** sign in with `ulysses.feria@gmail.com` → lands on the app; toolbar shows a `Trial · N days left` badge. Data screens work.
2. **Blocked:** in Supabase Studio, edit the Demo Clinic's `subscriptions` row → set `trial_ends_at` to a past date (and `status` stays `trialing`). Reload the app → you are redirected to `/blocked` with the "trial ended" message; app nav is gone. (Restore `trial_ends_at` to a future date afterward to keep using the app.)
3. **No access:** sign in with a Google account whose email is on NO clinic membership → redirected to `/no-access`. Sign out returns to `/login`.

Record pass/fail per case in the task report.

- [ ] **Step 6: Commit**

```bash
git add src/app/app.ts src/app/app.html src/app/app.scss src/app/core/auth/auth.service.ts
git commit -m "feat(access): plan badge in toolbar and clear context on logout"
```

---

## Phase 4 Done — Definition of Done

- `npx ng test --watch=false` + `npx ng build` both green.
- A user with no membership lands on `/no-access`; a user whose clinic subscription has lapsed lands on `/blocked` with an explanatory message; an active/trial user uses the app and sees a plan badge.
- Enforcement is still the DB (RLS); these screens make the already-empty state legible, they do not replace RLS.

## Notes for Later Phases (do NOT build here)

- The super-admin area + Edge Functions (create clinic, bulk-add member emails, activate/renew subscription) are Phase 5. Until then, flip subscription state via Supabase Studio to test the blocked screen.
- Multi-staff invite flows remain out of scope (admin bulk-seeds emails in Phase 5).
- A production `environment.ts` (hosted URL + anon key) is deferred to deployment.
