import { TestBed } from '@angular/core/testing';
import { ClinicContextService } from './clinic-context.service';
import { SUPABASE } from '../supabase.client';
import { vi } from 'vitest';

/** Minimal supabase stub: getUser + two table queries (memberships, subscriptions). */
function makeClient(opts: {
  userId?: string | null;
  membership?: { clinic_id: string; clinics: { name: string } } | null;
  subscription?: { status: string; trial_ends_at: string | null; active_until: string | null } | null;
}) {
  const maybeSingle = (row: unknown) => ({
    eq: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }),
  });
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: opts.userId ? { id: opts.userId } : null }, error: null }) },
    from: vi.fn((table: string) => ({
      select: () => (table === 'memberships' ? maybeSingle(opts.membership ?? null) : maybeSingle(opts.subscription ?? null)),
    })),
  };
}

function setup(client: unknown) {
  TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
  return TestBed.inject(ClinicContextService);
}

describe('ClinicContextService', () => {
  it('has no clinic when the user has no membership', async () => {
    const svc = setup(makeClient({ userId: 'u1', membership: null }));
    await svc.load();
    expect(svc.ready()).toBe(true);
    expect(svc.hasClinic()).toBe(false);
    expect(svc.isActive()).toBe(false);
  });

  it('is active during a live trial and reports days left', async () => {
    const future = new Date(Date.now() + 5 * 86400_000).toISOString();
    const svc = setup(makeClient({
      userId: 'u1',
      membership: { clinic_id: 'c1', clinics: { name: 'Demo Clinic' } },
      subscription: { status: 'trialing', trial_ends_at: future, active_until: null },
    }));
    await svc.load();
    expect(svc.hasClinic()).toBe(true);
    expect(svc.isActive()).toBe(true);
    expect(svc.access()?.clinicName).toBe('Demo Clinic');
    expect(svc.daysLeft()).toBe(5);
  });

  it('is not active when the trial has ended', async () => {
    const past = new Date(Date.now() - 86400_000).toISOString();
    const svc = setup(makeClient({
      userId: 'u1',
      membership: { clinic_id: 'c1', clinics: { name: 'Demo Clinic' } },
      subscription: { status: 'trialing', trial_ends_at: past, active_until: null },
    }));
    await svc.load();
    expect(svc.hasClinic()).toBe(true);
    expect(svc.isActive()).toBe(false);
  });

  it('is active on a paid plan until active_until', async () => {
    const future = new Date(Date.now() + 20 * 86400_000).toISOString();
    const svc = setup(makeClient({
      userId: 'u1',
      membership: { clinic_id: 'c1', clinics: { name: 'Demo Clinic' } },
      subscription: { status: 'active', trial_ends_at: '2020-01-01T00:00:00Z', active_until: future },
    }));
    await svc.load();
    expect(svc.isActive()).toBe(true);
  });
});
