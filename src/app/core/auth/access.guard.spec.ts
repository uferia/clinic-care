import { TestBed } from '@angular/core/testing';
import { RouterStateSnapshot, ActivatedRouteSnapshot, UrlTree, provideRouter } from '@angular/router';
import { accessGuard } from './access.guard';
import { ClinicContextService } from '../clinic/clinic-context.service';
import { SUPABASE } from '../supabase.client';

function run() {
  const state = { url: '/patients' } as RouterStateSnapshot;
  const route = {} as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(() => accessGuard(route, state));
}

describe('accessGuard', () => {
  function configure() {
    const client = { auth: {}, from: () => ({}) };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SUPABASE, useValue: client }],
    });
    return TestBed.inject(ClinicContextService);
  }

  it('redirects to /no-access when the user has no clinic', () => {
    const ctx = configure();
    ctx.access.set(null);
    const r = run();
    expect(r).toBeInstanceOf(UrlTree);
    expect((r as UrlTree).toString()).toContain('/no-access');
  });

  it('redirects to /blocked when the clinic subscription is not active', () => {
    const ctx = configure();
    ctx.access.set({ clinicId: 'c1', clinicName: 'X', address: null, phone: null, email: null, taxId: null, role: 'staff', status: 'trialing', trialEndsAt: '2020-01-01T00:00:00Z', activeUntil: null });
    const r = run();
    expect(r).toBeInstanceOf(UrlTree);
    expect((r as UrlTree).toString()).toContain('/blocked');
  });

  it('allows navigation for an active clinic', () => {
    const ctx = configure();
    const future = new Date(Date.now() + 86400_000).toISOString();
    ctx.access.set({ clinicId: 'c1', clinicName: 'X', address: null, phone: null, email: null, taxId: null, role: 'staff', status: 'trialing', trialEndsAt: future, activeUntil: null });
    expect(run()).toBe(true);
  });
});
