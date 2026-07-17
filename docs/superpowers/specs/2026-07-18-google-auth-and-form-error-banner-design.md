# Google Auth + Submit Error Banner — Design

Date: 2026-07-18
Status: Approved

> **Secret handling:** The real Google OAuth client ID is deliberately kept out of
> this repo and all docs. It is applied only as a local, uncommitted edit to
> `auth.config.ts` (marked `git update-index --skip-worktree`). Docs and tracked
> source use a placeholder.

## Goal

Two deliverables for the ClinicCare Angular app:

1. **Google Sign-In (GIS)** — gate the app behind a real "Sign in with Google"
   flow, backed by a route guard and a session stored client-side.
2. **Submit error banner** — surface API save failures on the patient, doctor,
   and appointment forms instead of silently swallowing them.

## Context

- Angular 22 standalone app, Material 22, signal forms (`@angular/forms/signals`).
- Backend is `json-server` reading `db.json` (`npm run api`, port 3000). It is a
  mock: no auth, no token verification, no real security boundary.
- Auth files were scaffolded but left empty: `core/auth/auth.service.ts`,
  `core/auth/auth.guard.ts`, `core/interceptors/auth.interceptor.ts`.
- Feature routes (`dashboard`, `patients`, `doctors`, `appointments`) currently
  have no guard and there is no login route.
- The three feature forms already share one polished pattern (touched/invalid
  Material errors, saving spinner, edit-mode load, disabled-until-valid). The one
  real gap: every `save()` error handler does only `this.saving.set(false)`, so a
  failed POST/PATCH gives the user no feedback.

## Honest limitation (must stay documented in code)

json-server cannot verify a Google ID token's signature. This design delivers a
real Google **login flow** but only **client-side trust** of the resulting
session. It is not server-enforced auth. This is acceptable for a mock-backed
demo and MUST be called out in a comment in `auth.service.ts` so no one mistakes
it for a security boundary.

## Part A — Google Sign-In (GIS)

### Flow

1. `index.html` loads the GIS client script (`https://accounts.google.com/gsi/client`).
2. Unauthenticated user hitting a protected route is redirected by `authGuard`
   to `/login?returnUrl=<original>`.
3. `LoginComponent` renders the official "Sign in with Google" button.
4. On success Google invokes a callback with `{ credential }` — a JWT ID token.
5. `AuthService.handleCredential()` decodes the JWT payload (base64url) for
   `email`, `name`, `picture`, `exp`, stores it in `localStorage`, and updates a
   `user` signal.
6. `LoginComponent` navigates to `returnUrl` (default `/dashboard`).
7. On reload, `AuthService` rehydrates the session from `localStorage` and drops
   it if `exp` has passed.

No Google One Tap — the button-only flow is the whole login UX.

### Files

| File | Change | Responsibility |
|---|---|---|
| `src/index.html` | edit | Add `<script src="https://accounts.google.com/gsi/client" async></script>`. |
| `src/app/core/auth/auth.config.ts` | new | Tracked file exports `GOOGLE_CLIENT_ID` set to a placeholder (`YOUR_CLIENT_ID.apps.googleusercontent.com`). The real client ID is applied only as a **local, uncommitted** edit — the file is marked `skip-worktree` so the real value is never staged or pushed. Comment notes the Google Cloud Console origin (`http://localhost:4200`) requirement. |
| `src/app/core/auth/google.d.ts` | new | Minimal ambient declaration for `window.google.accounts.id` (`initialize`, `renderButton`, `disableAutoSelect`) and the `CredentialResponse` shape. |
| `src/app/core/auth/auth.service.ts` | fill (empty) | `user` signal (`AuthUser \| null`); `ready` signal (GIS script loaded); `initialize()` (wait for `window.google`, call `google.accounts.id.initialize`); `renderButton(el)`; `handleCredential(resp)` (decode + persist + set signal); `logout()` (clear storage, `disableAutoSelect`, navigate `/login`); rehydrate + exp-check on construct; `isAuthenticated()` helper. Includes the honest-limitation comment. |
| `src/app/core/auth/auth.guard.ts` | fill (empty) | `authGuard: CanActivateFn` — return `true` if `AuthService.isAuthenticated()`, else `router.createUrlTree(['/login'], { queryParams: { returnUrl } })`. |
| `src/app/features/auth/login.component.ts` | new | Standalone component; on init calls `AuthService.initialize()` then `renderButton()` into a template ref; reads `returnUrl` query param; navigates there when `user` becomes non-null (via `effect`). Shows a short "signing you in" fallback until GIS is ready. |
| `src/app/core/interceptors/auth.interceptor.ts` | fill (empty) | `authInterceptor: HttpInterceptorFn` — if a session credential exists and the request targets `API`, attach `Authorization: Bearer <credential>`. Comment: json-server ignores this; included as the honest home for the token. |
| `src/app/app.config.ts` | edit | `provideHttpClient(withInterceptors([authInterceptor]))`. |
| `src/app/app.routes.ts` | edit | Add `{ path: 'login', loadComponent: … }`; add `canActivate: [authGuard]` to the `dashboard`, `patients`, `doctors`, `appointments` route groups. |
| `src/app/app.ts` + `src/app/app.html` | edit | Toolbar: when `user()` is set, show avatar (`picture`) + name + a logout button; when not set, hide the main nav. Inject `AuthService`. |

### Data shapes

```ts
interface AuthUser {
  email: string;
  name: string;
  picture: string;
  exp: number;      // seconds since epoch, from the ID token
  credential: string; // raw JWT, for the interceptor
}
```

`localStorage` key: `clinic-care.session`, holding JSON of `AuthUser`.

### JWT decode

Split the credential on `.`; base64url-decode the middle segment; `JSON.parse`.
A small private helper in `auth.service.ts`. No signature check (see limitation).

### Session validity

`isAuthenticated()` = session exists AND `exp * 1000 > Date.now()`. An expired
session is cleared on read so the guard treats it as signed out.

## Part B — Submit error banner

Applies identically to `patient-form.component.ts`, `doctor-form.component.ts`,
`appointment-form.component.ts`.

- Add `saveError = signal<string | null>(null)`.
- In `save()`: clear `saveError` before the request; in the `error` callback set
  `this.saveError.set("Couldn't save. Check the API is running and try again.")`
  alongside the existing `this.saving.set(false)`.
- Template: directly above `.actions`, render
  `@if (saveError()) { <div class="save-error" role="alert">{{ saveError() }}</div> }`.
- Style `.save-error` consistently across the three (Material error color tokens,
  spanning the full grid width). Identical snippet in each form's `styles`.

No other form changes — parity across the three is already in place.

## Testing / verification

- `npm run build` compiles clean (strict TS, no `google` type errors).
- Manual: with `npm run api` running and `npm start`:
  - Visiting `/patients` while signed out redirects to `/login?returnUrl=/patients`.
  - The Google button renders and a real sign-in completes, provided the local
    `auth.config.ts` holds a real client ID and `http://localhost:4200` is an
    authorized JS origin on it.
  - Forcing a save failure (stop `npm run api`) shows the error banner and leaves
    the form editable; a subsequent successful save clears it.
- `npm test` (vitest) still passes for existing specs.

## Out of scope

- Real server-side token verification (needs a real backend, not json-server).
- Google One Tap / auto-select.
- Per-role authorization (the seeded `users[0].role` is unused here).
- Refresh-token / silent renewal beyond the ID token's own `exp`.
