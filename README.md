# ClinicCare

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.0.7.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Backend (Supabase)

Local backend runs on Supabase (Docker required):

    npx supabase start     # start local Postgres + Auth
    npx supabase db reset  # apply all migrations + seed
    npx supabase test db   # run pgTAP tests
    npx supabase stop      # stop the stack

### Google sign-in (local)

1. Create a Google OAuth **Web** client (Google Cloud Console -> APIs & Services
   -> Credentials): authorized origin `http://localhost:4200`, redirect URI
   `http://127.0.0.1:54321/auth/v1/callback`.
2. Put the client id/secret in `supabase/.env` (gitignored — never commit):

       SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=...
       SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=...

3. `npx supabase stop && npx supabase start` to load the provider.
4. `npm start`, open http://localhost:4200, sign in with Google.

The provider is enabled in `config.toml` under `[auth.external.google]`; `site_url`
and `additional_redirect_urls` are set to the app origin `http://localhost:4200`.

### Admin area (super-admin)

Privileged actions — create a clinic, bulk-add staff emails, activate/renew or
expire a clinic's subscription — run as Supabase Edge Functions gated to
super-admins (a row in the `super_admins` table). `npx supabase start` serves the
functions in `supabase/functions/` automatically.

A super-admin sees an **Admin** link in the toolbar (`/admin`): the clinics list +
create form, and a per-clinic detail page to add members and set the subscription.
Reads use RLS (super-admins can read every clinic/subscription/membership); writes
go through the gated edge functions using the service-role key server-side.

## Translations (i18n)

The app ships in English only. The scaffolding to translate it is in place, so a
translator can be handed a file whenever a non-English clinic needs one — but no
translation exists yet, and the production build is a single English bundle.

    npm run i18n:extract      # writes src/locale/messages.xlf

`@angular/localize/init` is loaded via the `polyfills` entry on the build target
in `angular.json`; the unit-test target inherits it, which is why no spec imports
it directly.

**Marking convention.** Every user-facing string carries an explicit, stable ID —
`i18n="@@blocked.title"` in templates, `$localize\`:@@nav.patients:Patients\`` in
TypeScript. Explicit IDs mean rewording the English source does not orphan an
existing translation. Attributes use the `i18n-` prefix (`i18n-aria-label`,
`i18n-placeholder`); a string that only lives in TypeScript (a nav label, an error
message) needs `$localize`, since the template attribute cannot reach it.

**Coverage so far:** the app shell, the no-access / blocked / trial-banner screens.
Those are the screens a clinic hits before it can do anything, so they were marked
first. The remaining feature screens — patients, doctors, appointments, billing,
admin, clinic settings, onboarding — are **not yet marked**; their strings simply do
not appear in `messages.xlf` until they are. Mark them the same way, then re-run
the extract.

**Adding a locale** (when a translation actually exists): copy `messages.xlf` to
`messages.<locale>.xlf`, fill in each `<target>`, then add an `i18n.locales` entry
and a `localize` build option in `angular.json`. That produces one bundle per
locale and changes the deploy layout, so it is deliberately not configured yet.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
