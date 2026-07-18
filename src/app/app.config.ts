import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideNativeDateAdapter } from '@angular/material/core';

import { routes } from './app.routes';
import { provideSupabase } from './core/supabase.client';
import { AuthService } from './core/auth/auth.service';
import { ClinicContextService } from './core/clinic/clinic-context.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideNativeDateAdapter(),
    provideSupabase(),
    // Load the Supabase session and clinic context before the first route
    // activates so the guards can decide synchronously.
    provideAppInitializer(async () => {
      // inject() must run synchronously in the injection context — capture both
      // BEFORE any await (an inject after await throws NG0203 and blanks the app).
      const auth = inject(AuthService);
      const clinic = inject(ClinicContextService);
      await auth.initialize();
      await clinic.load();
    }),
    provideRouter(routes, withComponentInputBinding()),
  ],
};
