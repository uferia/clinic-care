import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Session } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.client';
import { ClinicContextService } from '../clinic/clinic-context.service';

export interface AuthUser {
  email: string;
  name: string;
  picture: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private supabase = inject(SUPABASE);
  private router = inject(Router);
  private clinic = inject(ClinicContextService);

  readonly user = signal<AuthUser | null>(null);
  readonly ready = signal(false);

  isAuthenticated(): boolean {
    return this.user() !== null;
  }

  /** Load the current session once and subscribe to future changes. Idempotent-safe. */
  async initialize(): Promise<void> {
    try {
      const { data } = await this.supabase.auth.getSession();
      this.setFromSession(data.session);
    } catch {
      this.setFromSession(null);
    }
    this.supabase.auth.onAuthStateChange((_event, session) => this.setFromSession(session));
    this.ready.set(true);
  }

  async signIn(returnUrl = '/dashboard'): Promise<void> {
    const redirectTo = `${window.location.origin}/login?returnUrl=${encodeURIComponent(returnUrl)}`;
    await this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
  }

  async logout(): Promise<void> {
    await this.supabase.auth.signOut();
    this.user.set(null);
    this.clinic.clear();
    this.router.navigate(['/login']);
  }

  private setFromSession(session: Session | null): void {
    if (!session?.user) {
      this.user.set(null);
      return;
    }
    const meta = (session.user.user_metadata ?? {}) as Record<string, string>;
    this.user.set({
      email: session.user.email ?? '',
      name: meta['full_name'] ?? meta['name'] ?? session.user.email ?? '',
      picture: meta['avatar_url'] ?? meta['picture'] ?? '',
    });
  }
}
