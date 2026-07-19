import { TestBed } from '@angular/core/testing';
import { RouterStateSnapshot, ActivatedRouteSnapshot, UrlTree, provideRouter } from '@angular/router';
import { superAdminGuard } from './super-admin.guard';
import { ClinicContextService } from '../clinic/clinic-context.service';
import { SUPABASE } from '../supabase.client';

function run() {
  return TestBed.runInInjectionContext(() =>
    superAdminGuard({} as ActivatedRouteSnapshot, { url: '/admin' } as RouterStateSnapshot));
}

describe('superAdminGuard', () => {
  function configure() {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SUPABASE, useValue: { auth: {}, from: () => ({}) } }],
    });
    return TestBed.inject(ClinicContextService);
  }

  it('allows a super-admin', () => {
    const ctx = configure();
    ctx.isSuperAdmin.set(true);
    expect(run()).toBe(true);
  });

  it('redirects a non-super-admin to /dashboard', () => {
    const ctx = configure();
    ctx.isSuperAdmin.set(false);
    const r = run();
    expect(r).toBeInstanceOf(UrlTree);
    expect((r as UrlTree).toString()).toContain('/dashboard');
  });
});
