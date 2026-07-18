import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideNativeDateAdapter } from '@angular/material/core';

import { routes } from './app.routes';
import { provideSupabase } from './core/supabase.client';
import { AuthService } from './core/auth/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideNativeDateAdapter(),
    provideSupabase(),
    // Load the Supabase session before the first route activates so the guard
    // can decide synchronously.
    provideAppInitializer(() => inject(AuthService).initialize()),
    provideRouter(routes, withComponentInputBinding()),
  ],
};
