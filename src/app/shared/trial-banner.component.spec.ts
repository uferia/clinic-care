import { TestBed } from '@angular/core/testing';
import { TrialBannerComponent } from './trial-banner.component';
import { ClinicContextService, ClinicAccess } from '../core/clinic/clinic-context.service';
import { SUPABASE } from '../core/supabase.client';

function inDays(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString();
}

function access(partial: Partial<ClinicAccess>): ClinicAccess {
  return {
    clinicId: 'c1',
    clinicName: 'Sunrise',
    role: 'clinic_admin',
    status: 'trialing',
    trialEndsAt: inDays(30),
    activeUntil: null,
    ...partial,
  };
}

function render(a: ClinicAccess | null): HTMLElement {
  TestBed.configureTestingModule({
    providers: [{ provide: SUPABASE, useValue: { auth: {}, from: () => ({}) } }],
  });
  TestBed.inject(ClinicContextService).access.set(a);
  const fixture = TestBed.createComponent(TrialBannerComponent);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('TrialBannerComponent', () => {
  it('stays quiet early in the trial', () => {
    expect(render(access({ trialEndsAt: inDays(20) })).textContent).toBe('');
  });

  it('warns inside the final week', () => {
    const text = render(access({ trialEndsAt: inDays(3) })).textContent ?? '';
    expect(text).toContain('ends in 3 days');
  });

  it('says tomorrow on the last full day', () => {
    // Just under 24h left so the ceiling lands on 1, not 2.
    const text = render(access({ trialEndsAt: inDays(0.9) })).textContent ?? '';
    expect(text).toContain('ends tomorrow');
  });

  it('stays quiet for an active paid subscription', () => {
    const paid = access({ status: 'active', trialEndsAt: inDays(-40), activeUntil: inDays(3) });
    expect(render(paid).textContent).toBe('');
  });

  it('stays quiet once the trial has already expired — the blocked screen owns that', () => {
    expect(render(access({ trialEndsAt: inDays(-1) })).textContent).toBe('');
  });

  it('stays quiet with no clinic at all', () => {
    expect(render(null).textContent).toBe('');
  });
});
