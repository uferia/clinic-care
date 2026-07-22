import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { OnboardingStore } from './onboarding.store';
import { SUPABASE } from '../../core/supabase.client';
import { ClinicContextService, ClinicAccess } from '../../core/clinic/clinic-context.service';

/** Per-table row counts the fake client reports back. */
function makeClient(counts: Record<string, number>) {
  return {
    auth: {},
    from: vi.fn((table: string) => ({
      select: () => Promise.resolve({ count: counts[table] ?? 0, error: null }),
    })),
  };
}

function access(role: ClinicAccess['role']): ClinicAccess {
  return {
    clinicId: 'c1',
    clinicName: 'Sunrise',
    address: null,
    phone: null,
    email: null,
    taxId: null,
    role,
    status: 'trialing',
    trialEndsAt: new Date(Date.now() + 86400_000).toISOString(),
    activeUntil: null,
  };
}

async function setup(counts: Record<string, number>, role: ClinicAccess['role'] = 'clinic_admin') {
  // Some tests set up twice to compare two clinics, so start from a clean module.
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: SUPABASE, useValue: makeClient(counts) }],
  });
  TestBed.inject(ClinicContextService).access.set(access(role));
  const store = TestBed.inject(OnboardingStore);
  await new Promise(r => setTimeout(r));
  return store;
}

describe('OnboardingStore', () => {
  it('marks nothing done for a brand-new clinic', async () => {
    const store = await setup({ memberships: 1 });
    expect(store.doneCount()).toBe(0);
    expect(store.total()).toBe(6);
    expect(store.complete()).toBe(false);
  });

  it('derives done state from what the clinic actually has', async () => {
    const store = await setup({ doctors: 2, services: 5, memberships: 1 });
    const done = store.steps().filter(s => s.done).map(s => s.key);
    expect(done).toEqual(['doctor', 'service']);
  });

  it('counts the billing step done once a settings row exists', async () => {
    const store = await setup({ billing_settings: 1, memberships: 1 });
    expect(store.steps().find(s => s.key === 'billing')?.done).toBe(true);
  });

  it('needs a second membership before the invite step counts — you are member one', async () => {
    const solo = await setup({ memberships: 1 });
    expect(solo.steps().find(s => s.key === 'team')?.done).toBe(false);
    const withStaff = await setup({ memberships: 2 });
    expect(withStaff.steps().find(s => s.key === 'team')?.done).toBe(true);
  });

  it('does not ask staff to invite anyone — they cannot', async () => {
    const store = await setup({ memberships: 1 }, 'staff');
    expect(store.steps().map(s => s.key)).not.toContain('team');
    expect(store.total()).toBe(5);
  });

  it('reports complete when every step is satisfied', async () => {
    const store = await setup({
      doctors: 1, services: 1, billing_settings: 1,
      patients: 1, appointments: 1, memberships: 2,
    });
    expect(store.complete()).toBe(true);
  });
});
