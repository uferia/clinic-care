import { TestBed } from '@angular/core/testing';
import { RouterStateSnapshot, ActivatedRouteSnapshot, UrlTree } from '@angular/router';
import { provideRouter } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';

function run(url: string) {
  const state = { url } as RouterStateSnapshot;
  const route = {} as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(() => authGuard(route, state));
}

describe('authGuard', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('allows navigation when authenticated', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('clinic-care.session', JSON.stringify({
      email: 'a@b.com', name: 'A', picture: '', exp: future, credential: 'x.y.z',
    }));
    // rehydrate the freshly-created service from storage
    TestBed.inject(AuthService);
    expect(run('/patients')).toBe(true);
  });

  it('redirects to /login with returnUrl when not authenticated', () => {
    const result = run('/patients');
    expect(result).toBeInstanceOf(UrlTree);
    const tree = result as UrlTree;
    expect(tree.toString()).toContain('/login');
    expect(tree.queryParams['returnUrl']).toBe('/patients');
  });
});
