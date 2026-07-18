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
