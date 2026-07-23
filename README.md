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

**Before production use**, someone with real Xendit sandbox access must also confirm:
`recurring.plan.activated` is the ONLY thing that grants paid access, so before relying on it for
real money, confirm it fires only after a GCash charge is actually captured — not merely the
instant the GCash account is linked, before money has moved. If Xendit fires it on linkage alone, a
clinic could be granted paid access before payment ever settles.

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
