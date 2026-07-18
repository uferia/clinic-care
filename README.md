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

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
