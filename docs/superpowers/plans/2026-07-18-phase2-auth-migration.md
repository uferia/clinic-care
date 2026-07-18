# Phase 2 — Auth Migration (Supabase Auth, Google) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw Google Identity Services (GIS) client-trusted sign-in with Supabase Auth's Google provider, so the session token is Supabase-issued and server-verifiable (RLS can trust `auth.uid()`).

**Architecture:** A single injected `SupabaseClient` owns auth. `AuthService` wraps it: it exposes a `user` signal (shape unchanged: `{ email, name, picture }` so the existing toolbar keeps working), loads the session once at app startup via `provideAppInitializer`, and reflects `onAuthStateChange`. The route guard stays synchronous (reads the already-loaded session signal). The hand-rolled JWT decode, localStorage session, `exp` checks, GIS script, and the HTTP auth interceptor are all deleted.

**Tech Stack:** Angular 22 (standalone, signals), `@supabase/supabase-js`, Angular Material, Vitest + jsdom.

## Global Constraints

- Auth is Supabase Auth (Google provider). No raw GIS, no `window.google`, no `accounts.google.com/gsi/client` script.
- Session and token lifecycle are owned by `supabase-js`. Do NOT hand-roll JWT decode, localStorage session storage, or `exp` expiry checks.
- `AuthService.user()` MUST remain a signal of `{ email: string; name: string; picture: string } | null` — `src/app/app.html` binds `user.picture` and `user.name`.
- Data layer stays on json-server this phase. Do NOT touch the feature stores or their HTTP calls; `provideHttpClient()` remains (only the auth interceptor is removed).
- Local Supabase config lives in `src/environments/environment.ts`. The local `anon` key is a public browser key (safe to commit); the Google OAuth **client secret** is NOT (kept in a gitignored `.env`, referenced via `env()` in `config.toml`).
- Angular 22 functional APIs: `provideAppInitializer`, `inject()`, functional guards.
- Commits carry NO `Co-Authored-By:` / Anthropic / Claude trailer — repo default author only.

---

### Task 1: Add supabase-js + environment config

**Files:**
- Modify: `package.json` (add dependency)
- Create: `src/environments/environment.ts`
- Create: `src/environments/environment.spec.ts`

**Interfaces:**
- Consumes: the local Supabase stack from Phase 1 (`npx supabase status` prints `API URL` + `anon key`).
- Produces: `environment` object `{ production: boolean; supabaseUrl: string; supabaseAnonKey: string }` imported by Task 2.

- [ ] **Step 1: Install the client library**

Run: `npm install @supabase/supabase-js`
Expected: adds `@supabase/supabase-js` to `dependencies` in `package.json`.

- [ ] **Step 2: Get the local Supabase URL + anon key**

Run: `npx supabase status`
Record `API URL` (expected `http://127.0.0.1:54321`) and `anon key` (a long JWT). The anon key is Supabase's standard local browser key — public by design, safe to commit.

- [ ] **Step 3: Write the environment file**

Create `src/environments/environment.ts` (paste the exact anon key from Step 2 in place of `<ANON_KEY>`):

```ts
export const environment = {
  production: false,
  // Local Supabase stack (npx supabase start). The anon key is a public,
  // browser-safe key — RLS is the security boundary, not this key.
  supabaseUrl: 'http://127.0.0.1:54321',
  supabaseAnonKey: '<ANON_KEY>',
};
```

- [ ] **Step 4: Write the failing test**

Create `src/environments/environment.spec.ts`:

```ts
import { environment } from './environment';

describe('environment', () => {
  it('exposes a Supabase URL and a non-empty anon key', () => {
    expect(environment.supabaseUrl).toMatch(/^https?:\/\//);
    expect(environment.supabaseAnonKey.length).toBeGreaterThan(20);
  });
});
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/environments/environment.spec.ts`
Expected: PASS (2 assertions). If the anon key placeholder wasn't replaced, it fails — replace it.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/environments/environment.ts src/environments/environment.spec.ts
git commit -m "chore(auth): add supabase-js and environment config"
```

---

### Task 2: Provide the Supabase client via DI

**Files:**
- Create: `src/app/core/supabase.client.ts`
- Create: `src/app/core/supabase.client.spec.ts`

**Interfaces:**
- Consumes: `environment` (Task 1).
- Produces:
  - `export const SUPABASE = new InjectionToken<SupabaseClient>('SUPABASE')`
  - `export function provideSupabase(): EnvironmentProviders` — registers the token with a real `createClient(...)` configured for PKCE + session persistence.
  - Consumers inject `inject(SUPABASE)` to get a `SupabaseClient`. Tests override the token with a stub.

- [ ] **Step 1: Write the failing test**

Create `src/app/core/supabase.client.spec.ts`:

```ts
import { createSupabaseClient } from './supabase.client';

describe('createSupabaseClient', () => {
  it('builds a client exposing the auth API', () => {
    const client = createSupabaseClient();
    expect(typeof client.auth.signInWithOAuth).toBe('function');
    expect(typeof client.auth.getSession).toBe('function');
    expect(typeof client.auth.onAuthStateChange).toBe('function');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/core/supabase.client.spec.ts`
Expected: FAIL — `Cannot find module './supabase.client'`.

- [ ] **Step 3: Implement the client provider**

Create `src/app/core/supabase.client.ts`:

```ts
import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

/** DI token for the shared Supabase client. Tests override it with a stub. */
export const SUPABASE = new InjectionToken<SupabaseClient>('SUPABASE');

/** Build the browser Supabase client (PKCE OAuth, persisted auto-refreshed session). */
export function createSupabaseClient(): SupabaseClient {
  return createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export function provideSupabase(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: SUPABASE, useFactory: createSupabaseClient },
  ]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/core/supabase.client.spec.ts`
Expected: PASS. (`createClient` constructs without any network call.)

- [ ] **Step 5: Commit**

```bash
git add src/app/core/supabase.client.ts src/app/core/supabase.client.spec.ts
git commit -m "feat(auth): provide shared Supabase client via DI"
```

---

### Task 3: Rewrite AuthService on Supabase Auth

**Files:**
- Rewrite: `src/app/core/auth/auth.service.ts`
- Rewrite: `src/app/core/auth/auth.service.spec.ts`
- Delete: `src/app/core/auth/google.d.ts`
- Delete: `src/app/core/auth/auth.config.ts`

**Interfaces:**
- Consumes: `SUPABASE` token (Task 2), `Router`.
- Produces the `AuthService` API used by the guard, toolbar, and login:
  - `readonly user: Signal<AuthUser | null>` where `AuthUser = { email: string; name: string; picture: string }`
  - `readonly ready: Signal<boolean>`
  - `isAuthenticated(): boolean`
  - `initialize(): Promise<void>` (loads session, subscribes to changes, sets `ready`)
  - `signIn(returnUrl?: string): Promise<void>`
  - `logout(): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/app/core/auth/auth.service.spec.ts` (replacing the old content — the old `decodeJwt` tests are deleted along with that function):

```ts
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { SUPABASE } from '../supabase.client';

type Handler = (event: string, session: unknown) => void;

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      email: 'doc@clinic.com',
      user_metadata: { full_name: 'Doc Holliday', avatar_url: 'http://x/p.png' },
    },
    ...overrides,
  };
}

describe('AuthService', () => {
  function setup(initialSession: unknown) {
    const handlerBox: { fn: Handler } = { fn: () => {} };
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const getSession = vi.fn().mockResolvedValue({ data: { session: initialSession }, error: null });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: (cb: Handler) => {
          handlerBox.fn = cb;
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        signInWithOAuth,
        signOut,
      },
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SUPABASE, useValue: client }],
    });
    const auth = TestBed.inject(AuthService);
    return { auth, handlerBox, signInWithOAuth, signOut, router: TestBed.inject(Router) };
  }

  it('loads the current session and maps it to a user', async () => {
    const { auth } = setup(makeSession());
    await auth.initialize();
    expect(auth.ready()).toBe(true);
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.user()).toEqual({
      email: 'doc@clinic.com', name: 'Doc Holliday', picture: 'http://x/p.png',
    });
  });

  it('has no user when there is no session', async () => {
    const { auth } = setup(null);
    await auth.initialize();
    expect(auth.ready()).toBe(true);
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.user()).toBeNull();
  });

  it('reflects a later sign-in via onAuthStateChange', async () => {
    const { auth, handlerBox } = setup(null);
    await auth.initialize();
    handlerBox.fn('SIGNED_IN', makeSession());
    expect(auth.user()?.email).toBe('doc@clinic.com');
  });

  it('signIn delegates to signInWithOAuth for google', async () => {
    const { auth, signInWithOAuth } = setup(null);
    await auth.initialize();
    await auth.signIn('/patients');
    expect(signInWithOAuth).toHaveBeenCalledOnce();
    expect(signInWithOAuth.mock.calls[0][0].provider).toBe('google');
  });

  it('logout signs out, clears the user, and routes to /login', async () => {
    const { auth, signOut, router } = setup(makeSession());
    await auth.initialize();
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await auth.logout();
    expect(signOut).toHaveBeenCalledOnce();
    expect(auth.user()).toBeNull();
    expect(nav).toHaveBeenCalledWith(['/login']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/core/auth/auth.service.spec.ts`
Expected: FAIL — current `AuthService` has no `SUPABASE` dependency / `signIn` method.

- [ ] **Step 3: Rewrite the service**

Replace `src/app/core/auth/auth.service.ts` entirely:

```ts
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Session } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.client';

export interface AuthUser {
  email: string;
  name: string;
  picture: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private supabase = inject(SUPABASE);
  private router = inject(Router);

  readonly user = signal<AuthUser | null>(null);
  readonly ready = signal(false);

  isAuthenticated(): boolean {
    return this.user() !== null;
  }

  /** Load the current session once and subscribe to future changes. Idempotent-safe. */
  async initialize(): Promise<void> {
    try {
      const { data } = await this.supabase.auth.getSession();
      this.setFromSession(data.session);
    } catch {
      this.setFromSession(null);
    }
    this.supabase.auth.onAuthStateChange((_event, session) => this.setFromSession(session));
    this.ready.set(true);
  }

  async signIn(returnUrl = '/dashboard'): Promise<void> {
    const redirectTo = `${window.location.origin}/login?returnUrl=${encodeURIComponent(returnUrl)}`;
    await this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
  }

  async logout(): Promise<void> {
    await this.supabase.auth.signOut();
    this.user.set(null);
    this.router.navigate(['/login']);
  }

  private setFromSession(session: Session | null): void {
    if (!session?.user) {
      this.user.set(null);
      return;
    }
    const meta = (session.user.user_metadata ?? {}) as Record<string, string>;
    this.user.set({
      email: session.user.email ?? '',
      name: meta['full_name'] ?? meta['name'] ?? session.user.email ?? '',
      picture: meta['avatar_url'] ?? meta['picture'] ?? '',
    });
  }
}
```

- [ ] **Step 4: Delete the obsolete GIS files**

```bash
git rm src/app/core/auth/google.d.ts src/app/core/auth/auth.config.ts
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/core/auth/auth.service.spec.ts`
Expected: PASS (5 assertions in the `AuthService` describe).

- [ ] **Step 6: Commit**

```bash
git add src/app/core/auth/auth.service.ts src/app/core/auth/auth.service.spec.ts
git commit -m "feat(auth): rewrite AuthService on Supabase Auth"
```

---

### Task 4: Simplify the guard, wire providers, delete the interceptor

**Files:**
- Rewrite: `src/app/core/auth/auth.guard.ts`
- Rewrite: `src/app/core/auth/auth.guard.spec.ts`
- Delete: `src/app/core/interceptors/auth.interceptor.ts`
- Delete: `src/app/core/interceptors/auth.interceptor.spec.ts`
- Modify: `src/app/app.config.ts`

**Interfaces:**
- Consumes: `AuthService` (Task 3), `provideSupabase` (Task 2).
- Produces: an app that loads the Supabase session before routing (`provideAppInitializer`), a synchronous `authGuard` that reads `AuthService.isAuthenticated()`, and an HTTP client with NO auth interceptor.

- [ ] **Step 1: Write the failing guard test**

Replace `src/app/core/auth/auth.guard.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { RouterStateSnapshot, ActivatedRouteSnapshot, UrlTree, provideRouter } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SUPABASE } from '../supabase.client';

function run(url: string) {
  const state = { url } as RouterStateSnapshot;
  const route = {} as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(() => authGuard(route, state));
}

describe('authGuard', () => {
  function configure() {
    const client = { auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signInWithOAuth: vi.fn(), signOut: vi.fn() } };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SUPABASE, useValue: client }],
    });
  }

  it('allows navigation when authenticated', () => {
    configure();
    TestBed.inject(AuthService).user.set({ email: 'a@b.com', name: 'A', picture: '' });
    expect(run('/patients')).toBe(true);
  });

  it('redirects to /login with returnUrl when not authenticated', () => {
    configure();
    TestBed.inject(AuthService); // user stays null
    const result = run('/patients');
    expect(result).toBeInstanceOf(UrlTree);
    expect((result as UrlTree).toString()).toContain('/login');
    expect((result as UrlTree).queryParams['returnUrl']).toBe('/patients');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/core/auth/auth.guard.spec.ts`
Expected: FAIL — old guard/service still reference localStorage/`SUPABASE` not provided the new way (or import error once interceptor is gone). Proceed to implement.

- [ ] **Step 3: Simplify the guard**

Replace `src/app/core/auth/auth.guard.ts`:

```ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated()) return true;
  return router.createUrlTree(['/login'], {
    queryParams: { returnUrl: state.url },
  });
};
```

- [ ] **Step 4: Delete the interceptor and its test**

```bash
git rm src/app/core/interceptors/auth.interceptor.ts src/app/core/interceptors/auth.interceptor.spec.ts
```

- [ ] **Step 5: Wire providers in app.config**

Replace `src/app/app.config.ts`:

```ts
import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';

import { routes } from './app.routes';
import { provideSupabase } from './core/supabase.client';
import { AuthService } from './core/auth/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Data layer still talks to json-server this phase; no auth interceptor.
    provideHttpClient(),
    provideNativeDateAdapter(),
    provideSupabase(),
    // Load the Supabase session before the first route activates so the guard
    // can decide synchronously.
    provideAppInitializer(() => inject(AuthService).initialize()),
    provideRouter(routes, withComponentInputBinding()),
  ],
};
```

- [ ] **Step 6: Run the guard test + full suite**

Run: `npx vitest run src/app/core/auth/auth.guard.spec.ts`
Expected: PASS (2 assertions).

Run: `npx vitest run`
Expected: the whole suite passes — no leftover references to the deleted interceptor/`auth.config`/`google.d.ts`. If a spec still imports a deleted symbol, that's Task 5's login/app specs — fix in Task 5.

- [ ] **Step 7: Commit**

```bash
git add src/app/core/auth/auth.guard.ts src/app/core/auth/auth.guard.spec.ts src/app/app.config.ts
git commit -m "feat(auth): synchronous guard, Supabase app-initializer, drop auth interceptor"
```

---

### Task 5: Swap the login UI + remove the GIS script

**Files:**
- Rewrite: `src/app/features/auth/login.component.ts`
- Modify: `src/index.html` (remove the GIS `<script>`)
- Create: `src/app/features/auth/login.component.spec.ts`

**Interfaces:**
- Consumes: `AuthService.signIn`, `AuthService.user` (Task 3).
- Produces: a login screen with a single "Sign in with Google" button that calls `auth.signIn(returnUrl)`, and redirects to `returnUrl` once `auth.user()` is set.

- [ ] **Step 1: Write the failing test**

Create `src/app/features/auth/login.component.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LoginComponent } from './login.component';
import { AuthService } from '../../core/auth/auth.service';
import { SUPABASE } from '../../core/supabase.client';

describe('LoginComponent', () => {
  function setup() {
    const client = { auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signInWithOAuth: vi.fn(), signOut: vi.fn() } };
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideRouter([]), { provide: SUPABASE, useValue: client }],
    });
    const auth = TestBed.inject(AuthService);
    const signIn = vi.spyOn(auth, 'signIn').mockResolvedValue();
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    return { fixture, signIn };
  }

  it('renders a Google sign-in button', () => {
    const { fixture } = setup();
    const btn = fixture.nativeElement.querySelector('button.google-signin');
    expect(btn).not.toBeNull();
  });

  it('calls auth.signIn when the button is clicked', () => {
    const { fixture, signIn } = setup();
    fixture.nativeElement.querySelector('button.google-signin').click();
    expect(signIn).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/features/auth/login.component.spec.ts`
Expected: FAIL — the current login has no `button.google-signin` (it renders a GIS host div).

- [ ] **Step 3: Rewrite the login component**

Replace `src/app/features/auth/login.component.ts`:

```ts
import { Component, effect, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  imports: [MatCardModule, MatIconModule, MatButtonModule],
  template: `
    <div class="login-wrap">
      <mat-card appearance="outlined" class="login-card">
        <mat-icon class="brand-mark">local_hospital</mat-icon>
        <h1>ClinicCare</h1>
        <p class="sub">Sign in to continue</p>
        <button mat-flat-button class="google-signin" (click)="signIn()">
          <mat-icon>login</mat-icon>
          Sign in with Google
        </button>
      </mat-card>
    </div>
  `,
  styles: `
    .login-wrap { min-height: 70vh; display: grid; place-items: center; }
    .login-card {
      display: flex; flex-direction: column; align-items: center;
      gap: 0.5rem; padding: 2rem 2.5rem; text-align: center;
    }
    .brand-mark {
      color: var(--mat-sys-primary);
      font-size: 2.5rem; width: 2.5rem; height: 2.5rem;
    }
    h1 { font: var(--mat-sys-headline-small); margin: 0.25rem 0 0; }
    .sub { color: var(--mat-sys-on-surface-variant); margin: 0 0 0.75rem; }
    .google-signin { margin-top: 0.25rem; }
  `,
})
export class LoginComponent {
  protected auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  constructor() {
    // Once a session exists (either already, or after the OAuth redirect
    // returns), leave for the requested page.
    effect(() => {
      if (this.auth.user()) {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/dashboard';
        this.router.navigateByUrl(returnUrl);
      }
    });
  }

  signIn(): void {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/dashboard';
    this.auth.signIn(returnUrl);
  }
}
```

- [ ] **Step 4: Remove the GIS script from index.html**

In `src/index.html`, delete this line (line 13):

```html
  <script src="https://accounts.google.com/gsi/client" async></script>
```

- [ ] **Step 5: Run the login test**

Run: `npx vitest run src/app/features/auth/login.component.spec.ts`
Expected: PASS (2 assertions).

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: whole suite green, including the existing `src/app/app.spec.ts` ("hides the main nav when signed out" still passes — with no session the toolbar `@if (auth.user())` is false). The toolbar reads `user.name`/`user.picture`, which the new `AuthService.user` still provides.

- [ ] **Step 7: Commit**

```bash
git add src/app/features/auth/login.component.ts src/app/features/auth/login.component.spec.ts src/index.html
git commit -m "feat(auth): Supabase Google sign-in button, remove GIS script"
```

---

### Task 6: Configure the Google provider + manual end-to-end verification

**Files:**
- Modify: `supabase/config.toml` (enable `[auth.external.google]`)
- Create: `.env` entry references (gitignored) — document only, do not commit secrets
- Modify: `.gitignore` (ensure `.env` is ignored)
- Modify: `README.md` (document Google auth setup + local E2E)

**Interfaces:**
- Consumes: a Google Cloud OAuth 2.0 Web client (created by the human).
- Produces: a locally working Google sign-in end-to-end; no automated test (external identity provider).

- [ ] **Step 1: Create a Google OAuth client (manual, human)**

In Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → Web application:
- Authorized JavaScript origins: `http://localhost:4200`
- Authorized redirect URI: `http://127.0.0.1:54321/auth/v1/callback`

Copy the generated Client ID and Client Secret.

- [ ] **Step 2: Put secrets in a gitignored .env**

Create/append `supabase/.env` (Supabase CLI reads it for `env()` refs) with:

```
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<client-id>
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<client-secret>
```

Confirm `.gitignore` ignores it — add if missing:

```
supabase/.env
```

Run: `git check-ignore supabase/.env`
Expected: prints the path (meaning it is ignored). The secret must never be committed.

- [ ] **Step 3: Enable the provider in config.toml**

In `supabase/config.toml`, set the `[auth.external.google]` block to:

```toml
[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
redirect_uri = "http://127.0.0.1:54321/auth/v1/callback"
```

Also confirm `[auth]` has `site_url = "http://localhost:4200"` and that `http://localhost:4200` is in `additional_redirect_urls` (add it if not).

- [ ] **Step 4: Restart Supabase to load the provider**

Run: `npx supabase stop && npx supabase start`
Expected: starts cleanly; the config now has Google enabled.

- [ ] **Step 5: Manual end-to-end sign-in**

Run the app: `npm start` (and `npm run api` for json-server data), open `http://localhost:4200`.
- You are redirected to `/login`; click "Sign in with Google".
- Complete Google consent; you are redirected back and land on `/dashboard`.
- The toolbar shows your Google name + avatar; nav links appear.
- Click sign out → you return to `/login` and nav disappears.
- Confirm binding: after your first login, in the DB the seeded owner membership/super_admin row for `ulysses.feria@gmail.com` now has `user_id` set (the Phase 1 `handle_new_user` trigger). Query via `docker exec` (see Phase 1 notes) or Supabase Studio.

Record the outcome (pass/fail + any errors) in the task report.

- [ ] **Step 6: Document in README**

Add a "Google sign-in (local)" subsection to the Backend section of `README.md`:

```markdown
### Google sign-in (local)

1. Create a Google OAuth Web client (origins `http://localhost:4200`,
   redirect `http://127.0.0.1:54321/auth/v1/callback`).
2. Put the client id/secret in `supabase/.env` (gitignored):

       SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=...
       SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=...

3. `npx supabase stop && npx supabase start` to load the provider.
4. `npm start` + `npm run api`, open http://localhost:4200, sign in with Google.
```

- [ ] **Step 7: Commit (config + docs only — NO secrets)**

```bash
git add supabase/config.toml .gitignore README.md
git commit -m "feat(auth): enable Supabase Google provider config and document setup"
```

---

## Phase 2 Done — Definition of Done

- `npx vitest run` passes: environment, supabase client, AuthService, authGuard, LoginComponent, and the existing app spec.
- No source references remain to GIS (`window.google`, `accounts.google.com`), `decodeJwt`, `GOOGLE_CLIENT_ID`, `credential`, localStorage sessions, or the auth interceptor.
- Manual E2E: Google sign-in via Supabase works locally end-to-end and binds the seeded membership.
- Data layer is still json-server (unchanged) — Phase 3 swaps the stores to `supabase-js`.

## Notes for Later Phases (do NOT build here)

- Access resolution (membership → clinic → subscription state) and the No-access / Blocked screens are Phase 4; the guard here only checks "is there a session".
- Swapping the feature stores from `HttpClient`/json-server to `supabase-js` is Phase 3; `provideHttpClient()` stays until then.
- Hosted deployment will need a production `environment.ts` (real project URL + anon key) and the Google provider configured in the hosted project's dashboard.
