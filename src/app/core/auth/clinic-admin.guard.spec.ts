import { TestBed } from '@angular/core/testing';
import { RouterStateSnapshot, ActivatedRouteSnapshot, UrlTree, provideRouter } from '@angular/router';
import { clinicAdminGuard } from './clinic-admin.guard';
import { ClinicContextService, ClinicAccess } from '../clinic/clinic-context.service';
import { SUPABASE } from '../supabase.client';

function run() {
  const state = { url: '/team' } as RouterStateSnapshot;
  const route = {} as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(() => clinicAdminGuard(route, state));
}

function access(role: ClinicAccess['role']): ClinicAccess {
  return {
    clinicId: 'c1',
    clinicName: 'X',
    role,
    status: 'trialing',
    trialEndsAt: new Date(Date.now() + 86400_000).toISOString(),
    activeUntil: null,
  };
}

describe('clinicAdminGuard', () => {
  function configure() {
    const client = { auth: {}, from: () => ({}) };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SUPABASE, useValue: client }],
    });
    return TestBed.inject(ClinicContextService);
  }

  it('allows a clinic_admin', () => {
    const ctx = configure();
    ctx.access.set(access('clinic_admin'));
    expect(run()).toBe(true);
  });

  it('redirects staff to /dashboard', () => {
    const ctx = configure();
    ctx.access.set(access('staff'));
    const r = run();
    expect(r).toBeInstanceOf(UrlTree);
    expect((r as UrlTree).toString()).toContain('/dashboard');
  });

  it('redirects when there is no clinic at all', () => {
    const ctx = configure();
    ctx.access.set(null);
    const r = run();
    expect(r).toBeInstanceOf(UrlTree);
    expect((r as UrlTree).toString()).toContain('/dashboard');
  });
});
