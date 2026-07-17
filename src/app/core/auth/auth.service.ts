import { Injectable, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { GOOGLE_CLIENT_ID } from './auth.config';

export interface AuthUser {
  email: string;
  name: string;
  picture: string;
  exp: number;        // seconds since epoch, from the ID token
  credential: string; // raw JWT, forwarded by the interceptor
}

interface GoogleIdPayload {
  email: string;
  name: string;
  picture: string;
  exp: number;
}

const STORAGE_KEY = 'clinic-care.session';

/** Decode a JWT's payload segment. No signature check — see AuthService note. */
export function decodeJwt(token: string): GoogleIdPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    b64 += '='.repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as GoogleIdPayload;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private router = inject(Router);

  // SECURITY NOTE: our mock API (json-server) cannot verify the Google ID
  // token's signature, so this session is trusted purely on the client. This is
  // a real Google *login flow* but NOT a server-enforced auth boundary — never
  // treat a present session as proof of identity against a real backend.
  readonly user = signal<AuthUser | null>(this.loadSession());
  readonly ready = signal(false);

  isAuthenticated(): boolean {
    const u = this.user();
    if (!u) return false;
    if (u.exp * 1000 <= Date.now()) {
      this.clear();
      return false;
    }
    return true;
  }

  /** Wait for the GIS script, then initialize the client. Idempotent. */
  async initialize(): Promise<void> {
    await this.waitForGis();
    window.google!.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: resp => this.handleCredential(resp),
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    this.ready.set(true);
  }

  renderButton(el: HTMLElement): void {
    window.google!.accounts.id.renderButton(el, {
      type: 'standard', theme: 'outline', size: 'large',
      text: 'signin_with', shape: 'pill',
    });
  }

  handleCredential(resp: CredentialResponse): void {
    const payload = decodeJwt(resp.credential);
    if (!payload) return;
    const user: AuthUser = {
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      exp: payload.exp,
      credential: resp.credential,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    this.user.set(user);
  }

  logout(): void {
    this.clear();
    window.google?.accounts.id.disableAutoSelect();
    this.router.navigate(['/login']);
  }

  private clear(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.user.set(null);
  }

  private loadSession(): AuthUser | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const u = JSON.parse(raw) as AuthUser;
      if (!u?.exp || u.exp * 1000 <= Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return u;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  private waitForGis(): Promise<void> {
    return new Promise(resolve => {
      if (window.google?.accounts?.id) return resolve();
      const timer = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(timer);
          resolve();
        }
      }, 50);
    });
  }
}
