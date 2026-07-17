# Google Auth + Form Error Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the ClinicCare app behind a real Google Sign-In flow with a route guard and client-side session, and surface API save failures on all three feature forms.

**Architecture:** Google Identity Services (GIS) renders a sign-in button on a new `/login` page; the returned JWT credential is decoded client-side into a `localStorage` session exposed as an `AuthService.user` signal. A `CanActivateFn` guard redirects unauthenticated users to `/login?returnUrl=…`. An HTTP interceptor attaches the credential as a bearer token (json-server ignores it — kept as the honest home for the token). Each form gains a `saveError` signal rendered as a Material-styled alert banner.

**Tech Stack:** Angular 22 (standalone, signals), Angular Material 22, `@angular/forms/signals`, json-server mock API, vitest via `@angular/build:unit-test`.

## Global Constraints

- Angular 22 standalone components only — no NgModules. Match existing file style.
- Google OAuth Web client ID is a **secret to this repo**: never write the real value into any tracked file, doc, or commit message. Tracked source uses the placeholder `YOUR_CLIENT_ID.apps.googleusercontent.com`; the real value is applied only as a local `skip-worktree` edit (see Task 1). Requires `http://localhost:4200` as an authorized JS origin in Google Cloud Console.
- API base is the `API` constant from `src/app/core/api.ts` (`http://localhost:3000`). Never hardcode the URL.
- json-server cannot verify the Google token signature — the session is client-side trust only. This limitation MUST stay documented in a code comment in `auth.service.ts`.
- Session `localStorage` key: `clinic-care.session`. Session validity = present AND `exp * 1000 > Date.now()`.
- Build gate: `npm run build` must compile clean. Unit specs run via `npx ng test --watch=false`.
- Commit after every task.

---

### Task 1: Auth foundation — config, GIS types, script tag

**Files:**
- Create: `src/app/core/auth/auth.config.ts`
- Create: `src/app/core/auth/google.d.ts`
- Modify: `src/index.html`

**Interfaces:**
- Consumes: nothing.
- Produces: `GOOGLE_CLIENT_ID: string` (from `auth.config.ts`); global ambient types `CredentialResponse`, `GsiButtonConfig`, `IdConfiguration`, and `window.google.accounts.id` methods `initialize`, `renderButton`, `prompt`, `disableAutoSelect`.

- [ ] **Step 1: Create `auth.config.ts` with a PLACEHOLDER only** (never commit the real ID)

```ts
/**
 * Google OAuth 2.0 Web client ID used by "Sign in with Google".
 *
 * Created in Google Cloud Console → APIs & Services → Credentials → OAuth client
 * (Web application). The app origin `http://localhost:4200` must be listed under
 * "Authorized JavaScript origins" for the button to render and sign-in to work.
 *
 * SECRET: replace the placeholder below with your real client ID LOCALLY only.
 * Do NOT commit the real value — Step 1b marks this file skip-worktree so your
 * local edit is never staged or pushed.
 */
export const GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
```

- [ ] **Step 1b: Protect the real ID from being committed**

After the file is committed with the placeholder (Step 5), the implementer sets
the real client ID locally and tells git to ignore that working-tree change:

```bash
git update-index --skip-worktree src/app/core/auth/auth.config.ts
```

Then edit `auth.config.ts` locally, replacing the placeholder with the real
client ID. Git will now report the file as unchanged and never stage the real
value. (To later edit the tracked file again: `git update-index --no-skip-worktree <path>`.)

- [ ] **Step 2: Create `google.d.ts`** (ambient — no imports/exports, so it augments global scope)

```ts
interface CredentialResponse {
  credential: string;
  select_by?: string;
}

interface IdConfiguration {
  client_id: string;
  callback: (response: CredentialResponse) => void;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
}

interface GsiButtonConfig {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'small' | 'medium' | 'large';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  width?: number;
}

interface Window {
  google?: {
    accounts: {
      id: {
        initialize(config: IdConfiguration): void;
        renderButton(parent: HTMLElement, options: GsiButtonConfig): void;
        prompt(): void;
        disableAutoSelect(): void;
      };
    };
  };
}
```

- [ ] **Step 3: Add the GIS script to `src/index.html`** — inside `<head>`, alongside existing tags:

```html
<script src="https://accounts.google.com/gsi/client" async></script>
```

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: build succeeds, no TS errors about `window.google` or missing `GOOGLE_CLIENT_ID`.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/auth/auth.config.ts src/app/core/auth/google.d.ts src/index.html
git commit -m "feat(auth): add Google client ID config, GIS types, and script tag"
```

---

### Task 2: AuthService + JWT decode

**Files:**
- Modify (fill empty): `src/app/core/auth/auth.service.ts`
- Test: `src/app/core/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `GOOGLE_CLIENT_ID` (Task 1); global GIS types (Task 1).
- Produces:
  - `interface AuthUser { email: string; name: string; picture: string; exp: number; credential: string; }`
  - `function decodeJwt(token: string): { email: string; name: string; picture: string; exp: number } | null`
  - `class AuthService` with: `user` (`WritableSignal<AuthUser | null>`), `ready` (`WritableSignal<boolean>`), `isAuthenticated(): boolean`, `initialize(): Promise<void>`, `renderButton(el: HTMLElement): void`, `handleCredential(resp: CredentialResponse): void`, `logout(): void`.

- [ ] **Step 1: Write the failing test** — `src/app/core/auth/auth.service.spec.ts`

```ts
import { decodeJwt } from './auth.service';

/** Build a JWT with the given payload (unsigned; signature segment is ignored). */
function makeJwt(payload: object): string {
  const b64url = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'none' })}.${b64url(payload)}.sig`;
}

describe('decodeJwt', () => {
  it('decodes the payload of a well-formed token', () => {
    const token = makeJwt({
      email: 'a@b.com', name: 'Ada Lovelace',
      picture: 'http://x/p.png', exp: 1893456000,
    });
    expect(decodeJwt(token)).toEqual({
      email: 'a@b.com', name: 'Ada Lovelace',
      picture: 'http://x/p.png', exp: 1893456000,
    });
  });

  it('returns null for a token without three segments', () => {
    expect(decodeJwt('not.a')).toBeNull();
  });

  it('returns null when the payload is not valid JSON', () => {
    expect(decodeJwt('aaa.@@@.bbb')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ng test --watch=false`
Expected: FAIL — `decodeJwt` is not exported / file empty.

- [ ] **Step 3: Fill `auth.service.ts`**

```ts
import { Injectable, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { GOOGLE_CLIENT_ID } from './auth.config';

export interface AuthUser {
  email: string;
  name: string;
  picture: string;
  exp: number;        // seconds since epoch, from the ID token
  credential: string; // raw JWT, forwarded by the interceptor
}

interface GoogleIdPayload {
  email: string;
  name: string;
  picture: string;
  exp: number;
}

const STORAGE_KEY = 'clinic-care.session';

/** Decode a JWT's payload segment. No signature check — see AuthService note. */
export function decodeJwt(token: string): GoogleIdPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    b64 += '='.repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as GoogleIdPayload;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private router = inject(Router);

  // SECURITY NOTE: our mock API (json-server) cannot verify the Google ID
  // token's signature, so this session is trusted purely on the client. This is
  // a real Google *login flow* but NOT a server-enforced auth boundary — never
  // treat a present session as proof of identity against a real backend.
  readonly user = signal<AuthUser | null>(this.loadSession());
  readonly ready = signal(false);

  isAuthenticated(): boolean {
    const u = this.user();
    if (!u) return false;
    if (u.exp * 1000 <= Date.now()) {
      this.clear();
      return false;
    }
    return true;
  }

  /** Wait for the GIS script, then initialize the client. Idempotent. */
  async initialize(): Promise<void> {
    await this.waitForGis();
    window.google!.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: resp => this.handleCredential(resp),
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    this.ready.set(true);
  }

  renderButton(el: HTMLElement): void {
    window.google!.accounts.id.renderButton(el, {
      type: 'standard', theme: 'outline', size: 'large',
      text: 'signin_with', shape: 'pill',
    });
  }

  handleCredential(resp: CredentialResponse): void {
    const payload = decodeJwt(resp.credential);
    if (!payload) return;
    const user: AuthUser = {
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      exp: payload.exp,
      credential: resp.credential,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    this.user.set(user);
  }

  logout(): void {
    this.clear();
    window.google?.accounts.id.disableAutoSelect();
    this.router.navigate(['/login']);
  }

  private clear(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.user.set(null);
  }

  private loadSession(): AuthUser | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const u = JSON.parse(raw) as AuthUser;
      if (!u?.exp || u.exp * 1000 <= Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return u;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  private waitForGis(): Promise<void> {
    return new Promise(resolve => {
      if (window.google?.accounts?.id) return resolve();
      const timer = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(timer);
          resolve();
        }
      }, 50);
    });
  }
}
```

- [ ] **Step 4: Add a session-validity test** — append to `auth.service.spec.ts`

```ts
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from './auth.service';

describe('AuthService session validity', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('is not authenticated with no session', () => {
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(false);
  });

  it('is authenticated for an unexpired stored session', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('clinic-care.session', JSON.stringify({
      email: 'a@b.com', name: 'A', picture: '', exp: future, credential: 'x.y.z',
    }));
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(true);
  });

  it('drops an expired stored session', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    localStorage.setItem('clinic-care.session', JSON.stringify({
      email: 'a@b.com', name: 'A', picture: '', exp: past, credential: 'x.y.z',
    }));
    const auth = TestBed.inject(AuthService);
    expect(auth.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('clinic-care.session')).toBeNull();
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS — all `decodeJwt` and session-validity tests green.

- [ ] **Step 6: Commit**

```bash
git add src/app/core/auth/auth.service.ts src/app/core/auth/auth.service.spec.ts
git commit -m "feat(auth): implement AuthService with JWT decode and session handling"
```

---

### Task 3: Route guard

**Files:**
- Modify (fill empty): `src/app/core/auth/auth.guard.ts`
- Test: `src/app/core/auth/auth.guard.spec.ts`

**Interfaces:**
- Consumes: `AuthService.isAuthenticated()` (Task 2).
- Produces: `authGuard: CanActivateFn` — returns `true` when authenticated, else a `UrlTree` for `/login` with `queryParams.returnUrl = state.url`.

- [ ] **Step 1: Write the failing test** — `src/app/core/auth/auth.guard.spec.ts`

```ts
import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot, ActivatedRouteSnapshot, UrlTree } from '@angular/router';
import { provideRouter } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';

function run(url: string) {
  const state = { url } as RouterStateSnapshot;
  const route = {} as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(() => authGuard(route, state));
}

describe('authGuard', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('allows navigation when authenticated', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('clinic-care.session', JSON.stringify({
      email: 'a@b.com', name: 'A', picture: '', exp: future, credential: 'x.y.z',
    }));
    // rehydrate the freshly-created service from storage
    TestBed.inject(AuthService);
    expect(run('/patients')).toBe(true);
  });

  it('redirects to /login with returnUrl when not authenticated', () => {
    const result = run('/patients');
    expect(result).toBeInstanceOf(UrlTree);
    const tree = result as UrlTree;
    expect(tree.toString()).toContain('/login');
    expect(tree.queryParams['returnUrl']).toBe('/patients');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ng test --watch=false`
Expected: FAIL — `authGuard` not exported / file empty.

- [ ] **Step 3: Fill `auth.guard.ts`**

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS — both guard tests green.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/auth/auth.guard.ts src/app/core/auth/auth.guard.spec.ts
git commit -m "feat(auth): add route guard redirecting to login with returnUrl"
```

---

### Task 4: HTTP auth interceptor

**Files:**
- Modify (fill empty): `src/app/core/interceptors/auth.interceptor.ts`
- Test: `src/app/core/interceptors/auth.interceptor.spec.ts`

**Interfaces:**
- Consumes: `AuthService.user` (Task 2); `API` from `src/app/core/api.ts`.
- Produces: `authInterceptor: HttpInterceptorFn` — attaches `Authorization: Bearer <credential>` when a session exists and `req.url` starts with `API`.

- [ ] **Step 1: Write the failing test** — `src/app/core/interceptors/auth.interceptor.spec.ts`

```ts
import { TestBed } from '@angular/core/testing';
import { HttpRequest, HttpHandlerFn, HttpEvent } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of, Observable } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../auth/auth.service';
import { API } from '../api';

function capture(url: string): HttpRequest<unknown> {
  let seen!: HttpRequest<unknown>;
  const next: HttpHandlerFn = (req): Observable<HttpEvent<unknown>> => {
    seen = req;
    return of({} as HttpEvent<unknown>);
  };
  TestBed.runInInjectionContext(() =>
    authInterceptor(new HttpRequest('GET', url), next).subscribe(),
  );
  return seen;
}

describe('authInterceptor', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('attaches a bearer token to API requests when signed in', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('clinic-care.session', JSON.stringify({
      email: 'a@b.com', name: 'A', picture: '', exp: future, credential: 'tok123',
    }));
    TestBed.inject(AuthService);
    const req = capture(`${API}/patients`);
    expect(req.headers.get('Authorization')).toBe('Bearer tok123');
  });

  it('does not attach a token when signed out', () => {
    const req = capture(`${API}/patients`);
    expect(req.headers.has('Authorization')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ng test --watch=false`
Expected: FAIL — `authInterceptor` not exported / file empty.

- [ ] **Step 3: Fill `auth.interceptor.ts`**

```ts
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { API } from '../api';

// json-server performs no auth and ignores this header. It is attached as the
// honest place the session token would travel to a real backend.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const user = inject(AuthService).user();
  if (user && req.url.startsWith(API)) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${user.credential}` },
    });
  }
  return next(req);
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS — both interceptor tests green.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/interceptors/auth.interceptor.ts src/app/core/interceptors/auth.interceptor.spec.ts
git commit -m "feat(auth): attach bearer token to API requests via interceptor"
```

---

### Task 5: Login page

**Files:**
- Create: `src/app/features/auth/login.component.ts`

**Interfaces:**
- Consumes: `AuthService` (`initialize`, `renderButton`, `ready`, `user`) (Task 2); `ActivatedRoute` query param `returnUrl`.
- Produces: `LoginComponent` (standalone), used by the `/login` route in Task 6.

- [ ] **Step 1: Create `login.component.ts`**

```ts
import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  imports: [MatCardModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="login-wrap">
      <mat-card appearance="outlined" class="login-card">
        <mat-icon class="brand-mark">local_hospital</mat-icon>
        <h1>ClinicCare</h1>
        <p class="sub">Sign in to continue</p>
        <div #gbtn class="gbtn"></div>
        @if (!auth.ready()) {
          <div class="loading">
            <mat-spinner diameter="24" />
            <span>Loading sign-in…</span>
          </div>
        }
      </mat-card>
    </div>
  `,
  styles: `
    .login-wrap {
      min-height: 70vh;
      display: grid;
      place-items: center;
    }

    .login-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      padding: 2rem 2.5rem;
      text-align: center;
    }

    .brand-mark {
      color: var(--mat-sys-primary);
      font-size: 2.5rem;
      width: 2.5rem;
      height: 2.5rem;
    }

    h1 {
      font: var(--mat-sys-headline-small);
      margin: 0.25rem 0 0;
    }

    .sub {
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 0.5rem;
    }

    .gbtn {
      min-height: 44px;
      display: flex;
      justify-content: center;
    }

    .loading {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class LoginComponent {
  protected auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  private buttonHost = viewChild<ElementRef<HTMLElement>>('gbtn');

  constructor() {
    // Render the Google button once the GIS client is ready and the host exists.
    effect(() => {
      const host = this.buttonHost();
      if (this.auth.ready() && host) {
        this.auth.renderButton(host.nativeElement);
      }
    });
    // Leave for the requested page the moment a session appears.
    effect(() => {
      if (this.auth.user()) {
        const returnUrl =
          this.route.snapshot.queryParamMap.get('returnUrl') ?? '/dashboard';
        this.router.navigateByUrl(returnUrl);
      }
    });
    this.auth.initialize();
  }
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: build succeeds, no template or type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/features/auth/login.component.ts
git commit -m "feat(auth): add login page rendering the Google sign-in button"
```

---

### Task 6: Wire interceptor and routes

**Files:**
- Modify: `src/app/app.config.ts`
- Modify: `src/app/app.routes.ts`

**Interfaces:**
- Consumes: `authInterceptor` (Task 4), `authGuard` (Task 3), `LoginComponent` (Task 5).
- Produces: `/login` route; `canActivate: [authGuard]` on the `dashboard`, `patients`, `doctors`, `appointments` route groups.

- [ ] **Step 1: Register the interceptor in `app.config.ts`** — replace the `provideHttpClient()` line.

Change the import:

```ts
import { provideHttpClient, withInterceptors } from '@angular/common/http';
```

Add the interceptor import:

```ts
import { authInterceptor } from './core/interceptors/auth.interceptor';
```

Replace `provideHttpClient(),` with:

```ts
    provideHttpClient(withInterceptors([authInterceptor])),
```

- [ ] **Step 2: Add the login route and guards in `app.routes.ts`**

Add the guard import at the top:

```ts
import { authGuard } from './core/auth/auth.guard';
```

Add a login route after the `dashboard` block's opening (place it as the second entry, before `patients`):

```ts
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login.component').then(m => m.LoginComponent),
  },
```

Add `canActivate: [authGuard],` as a property on each of the four protected route objects. For `dashboard`:

```ts
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
  },
```

For `patients`, `doctors`, `appointments`, add the same `canActivate: [authGuard],` line directly under each `path:` line, keeping their existing `children` arrays unchanged. Example for `patients`:

```ts
  {
    path: 'patients',
    canActivate: [authGuard],
    children: [
      { path: '', loadComponent: () => import('./features/patients/patient-list.component').then(m => m.PatientListComponent) },
      { path: 'new', loadComponent: () => import('./features/patients/patient-form.component').then(m => m.PatientFormComponent) },
      { path: ':id', loadComponent: () => import('./features/patients/patient-form.component').then(m => m.PatientFormComponent) },
    ],
  },
```

Leave the `'' redirectTo dashboard` and `'**' redirectTo dashboard` entries unchanged.

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual verification**

With `npm run api` running in one terminal and `npm start` in another, open `http://localhost:4200/patients` in a fresh/incognito window.
Expected: the URL redirects to `http://localhost:4200/login?returnUrl=%2Fpatients` and the Google button renders. (Completing sign-in requires `http://localhost:4200` to be an authorized origin on the client ID.)

- [ ] **Step 5: Commit**

```bash
git add src/app/app.config.ts src/app/app.routes.ts
git commit -m "feat(auth): guard feature routes and register the auth interceptor"
```

---

### Task 7: Toolbar user + logout

**Files:**
- Modify: `src/app/app.ts`
- Modify: `src/app/app.html`
- Modify: `src/app/app.spec.ts`

**Interfaces:**
- Consumes: `AuthService.user` and `AuthService.logout()` (Task 2).
- Produces: toolbar shows avatar + name + logout when signed in; hides nav when signed out.

- [ ] **Step 1: Update `app.spec.ts` to match the real component** (existing spec asserts a non-existent "Hello, clinic-care" h1 and lacks a router provider)

```ts
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('hides the main nav when signed out', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.main-nav')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the app spec to verify the nav test passes against current markup**

Run: `npx ng test --watch=false`
Expected: `should create the app` PASSES; `hides the main nav when signed out` FAILS (nav currently always rendered). This confirms the test drives Step 3.

- [ ] **Step 3: Update `app.ts`**

```ts
import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from './core/auth/auth.service';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected auth = inject(AuthService);

  links = [
    { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { path: '/patients', label: 'Patients', icon: 'groups' },
    { path: '/doctors', label: 'Doctors', icon: 'medical_services' },
    { path: '/appointments', label: 'Appointments', icon: 'event' },
  ];

  logout() {
    this.auth.logout();
  }
}
```

- [ ] **Step 4: Update `app.html`** — gate nav and user chrome behind a session

```html
<mat-toolbar class="app-bar">
  <mat-icon class="brand-mark">local_hospital</mat-icon>
  <span class="brand">ClinicCare</span>
  <span class="spacer"></span>

  @if (auth.user(); as user) {
    <nav class="main-nav" aria-label="Main">
      @for (link of links; track link.path) {
        <a mat-button [routerLink]="link.path" routerLinkActive="active-link">
          <mat-icon>{{ link.icon }}</mat-icon>
          <span class="nav-text">{{ link.label }}</span>
        </a>
      }
    </nav>

    <span class="user">
      <img
        class="avatar"
        [src]="user.picture"
        [alt]="user.name"
        referrerpolicy="no-referrer" />
      <span class="user-name">{{ user.name }}</span>
    </span>
    <button mat-icon-button (click)="logout()" aria-label="Sign out">
      <mat-icon>logout</mat-icon>
    </button>
  }
</mat-toolbar>

<main class="page">
  <router-outlet />
</main>
```

- [ ] **Step 5: Add styles for the user chrome** — append to `src/app/app.scss`

```scss
.user {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: 0.5rem;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
}

.user-name {
  font: var(--mat-sys-body-medium);
}

@media (max-width: 40rem) {
  .user-name {
    display: none;
  }
}
```

- [ ] **Step 6: Run tests and build**

Run: `npx ng test --watch=false` then `npm run build`
Expected: both app specs PASS; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/app/app.ts src/app/app.html src/app/app.scss src/app/app.spec.ts
git commit -m "feat(auth): show signed-in user and logout in the toolbar"
```

---

### Task 8: Submit error banner on all three forms

**Files:**
- Modify: `src/app/features/patients/patient-form.component.ts`
- Modify: `src/app/features/doctors/doctor-form.component.ts`
- Modify: `src/app/features/appointments/appointment-form.component.ts`

**Interfaces:**
- Consumes: nothing new (`signal` already imported in all three).
- Produces: a `saveError` signal + alert banner on each form; set on save failure, cleared on retry.

For **each** of the three form components, apply the same four edits:

- [ ] **Step 1: Add the `saveError` signal** — next to the existing `saving = signal(false);` field:

```ts
  saveError = signal<string | null>(null);
```

- [ ] **Step 2: Clear and set the error in `save()`** — the existing `save()` sets `this.saving.set(true)` then subscribes with `error: () => this.saving.set(false)`. Change those two spots.

Immediately after `this.saving.set(true);`, add:

```ts
    this.saveError.set(null);
```

Replace the subscribe `error` handler `error: () => this.saving.set(false),` with:

```ts
      error: () => {
        this.saving.set(false);
        this.saveError.set(
          "Couldn't save. Check the API is running and try again.",
        );
      },
```

- [ ] **Step 3: Render the banner in the template** — directly above the `<div class="actions">` block:

```html
          @if (saveError()) {
            <div class="save-error" role="alert">{{ saveError() }}</div>
          }
```

- [ ] **Step 4: Add the banner style** — inside the component's `styles`, next to the `.actions` rule:

```css
    .save-error {
      grid-column: 1 / -1;
      margin-top: 0.5rem;
      padding: 0.625rem 0.875rem;
      border-radius: 0.5rem;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      font: var(--mat-sys-body-small);
    }
```

- [ ] **Step 5: Verify build compiles**

Run: `npm run build`
Expected: build succeeds for all three modified forms.

- [ ] **Step 6: Manual verification**

With `npm start` running but `npm run api` STOPPED, open `/patients/new`, fill valid fields, and click Save.
Expected: the red banner "Couldn't save. Check the API is running and try again." appears, the spinner stops, and the form stays editable. Repeat the check for `/doctors/new` and `/appointments/new`. Restart `npm run api`, save again → banner clears and navigation succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/app/features/patients/patient-form.component.ts src/app/features/doctors/doctor-form.component.ts src/app/features/appointments/appointment-form.component.ts
git commit -m "feat(forms): show a save error banner when the API request fails"
```

---

## Final verification

- [ ] `npm run build` — clean compile.
- [ ] `npx ng test --watch=false` — all specs pass (decodeJwt, session validity, guard, interceptor, app).
- [ ] Manual smoke: signed-out redirect to `/login`; button renders; forced save failure shows banner on each form.
