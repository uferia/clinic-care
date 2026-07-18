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
      await inject(AuthService).initialize();
      await inject(ClinicContextService).load();
    }),
    provideRouter(routes, withComponentInputBinding()),
  ],
};
