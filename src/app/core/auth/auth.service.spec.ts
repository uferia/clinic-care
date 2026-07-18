import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { SUPABASE } from '../supabase.client';

type Handler = (event: string, session: unknown) => void;

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      email: 'doc@clinic.com',
      user_metadata: { full_name: 'Doc Holliday', avatar_url: 'http://x/p.png' },
    },
    ...overrides,
  };
}

describe('AuthService', () => {
  function setup(initialSession: unknown) {
    const handlerBox: { fn: Handler } = { fn: () => {} };
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const getSession = vi.fn().mockResolvedValue({ data: { session: initialSession }, error: null });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: (cb: Handler) => {
          handlerBox.fn = cb;
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        signInWithOAuth,
        signOut,
      },
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SUPABASE, useValue: client }],
    });
    const auth = TestBed.inject(AuthService);
    return { auth, handlerBox, signInWithOAuth, signOut, router: TestBed.inject(Router) };
  }

  it('loads the current session and maps it to a user', async () => {
    const { auth } = setup(makeSession());
    await auth.initialize();
    expect(auth.ready()).toBe(true);
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.user()).toEqual({
      email: 'doc@clinic.com', name: 'Doc Holliday', picture: 'http://x/p.png',
    });
  });

  it('has no user when there is no session', async () => {
    const { auth } = setup(null);
    await auth.initialize();
    expect(auth.ready()).toBe(true);
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.user()).toBeNull();
  });

  it('reflects a later sign-in via onAuthStateChange', async () => {
    const { auth, handlerBox } = setup(null);
    await auth.initialize();
    handlerBox.fn('SIGNED_IN', makeSession());
    expect(auth.user()?.email).toBe('doc@clinic.com');
  });

  it('signIn delegates to signInWithOAuth for google', async () => {
    const { auth, signInWithOAuth } = setup(null);
    await auth.initialize();
    await auth.signIn('/patients');
    expect(signInWithOAuth).toHaveBeenCalledOnce();
    expect(signInWithOAuth.mock.calls[0][0].provider).toBe('google');
  });

  it('logout signs out, clears the user, and routes to /login', async () => {
    const { auth, signOut, router } = setup(makeSession());
    await auth.initialize();
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await auth.logout();
    expect(signOut).toHaveBeenCalledOnce();
    expect(auth.user()).toBeNull();
    expect(nav).toHaveBeenCalledWith(['/login']);
  });
});
