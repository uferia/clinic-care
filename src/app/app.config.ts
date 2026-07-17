import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    // Material's datepicker/timepicker need an adapter; the native one works in
    // Date and needs no extra dependency.
    provideNativeDateAdapter(),
    provideRouter(routes, withComponentInputBinding())
  ]
};
