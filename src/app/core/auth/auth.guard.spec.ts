import { TestBed } from '@angular/core/testing';
import { RouterStateSnapshot, ActivatedRouteSnapshot, UrlTree, provideRouter } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SUPABASE } from '../supabase.client';

function run(url: string) {
  const state = { url } as RouterStateSnapshot;
  const route = {} as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(() => authGuard(route, state));
}

describe('authGuard', () => {
  function configure() {
    const client = { auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signInWithOAuth: vi.fn(), signOut: vi.fn() } };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SUPABASE, useValue: client }],
    });
  }

  it('allows navigation when authenticated', () => {
    configure();
    TestBed.inject(AuthService).user.set({ email: 'a@b.com', name: 'A', picture: '' });
    expect(run('/patients')).toBe(true);
  });

  it('redirects to /login with returnUrl when not authenticated', () => {
    configure();
    TestBed.inject(AuthService); // user stays null
    const result = run('/patients');
    expect(result).toBeInstanceOf(UrlTree);
    expect((result as UrlTree).toString()).toContain('/login');
    expect((result as UrlTree).queryParams['returnUrl']).toBe('/patients');
  });
});
