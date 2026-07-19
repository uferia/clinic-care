import { TestBed } from '@angular/core/testing';
import { AdminStore } from './admin.store';
import { SUPABASE } from '../../core/supabase.client';
import { vi } from 'vitest';

const clinicRows = [
  {
    id: 'c1', name: 'Demo Clinic', created_at: '2026-07-01T00:00:00Z',
    subscriptions: { status: 'trialing', trial_ends_at: '2026-07-15T00:00:00Z', active_until: null },
    memberships: [{ count: 3 }],
  },
];

function makeClient(invoke = vi.fn().mockResolvedValue({ data: {}, error: null })) {
  return {
    functions: { invoke },
    from: vi.fn(() => ({
      select: () => ({ order: () => Promise.resolve({ data: clinicRows, error: null }) }),
    })),
  };
}

describe('AdminStore', () => {
  function setup(client: unknown) {
    TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
    return TestBed.inject(AdminStore);
  }

  it('loads clinics and maps subscription + member count', async () => {
    const store = setup(makeClient());
    await new Promise(r => setTimeout(r));
    const c = store.clinics()[0];
    expect(c.name).toBe('Demo Clinic');
    expect(c.status).toBe('trialing');
    expect(c.memberCount).toBe(3);
  });

  it('createClinic invokes the edge function then reloads', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { clinic: { id: 'c2' } }, error: null });
    const store = setup(makeClient(invoke));
    await new Promise(r => setTimeout(r));
    await store.createClinic('New Clinic');
    expect(invoke).toHaveBeenCalledWith('create-clinic', { body: { name: 'New Clinic' } });
  });

  it('activate invokes set-subscription with months', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { subscription: {} }, error: null });
    const store = setup(makeClient(invoke));
    await new Promise(r => setTimeout(r));
    await store.activate('c1', 1);
    expect(invoke).toHaveBeenCalledWith('set-subscription', { body: { clinic_id: 'c1', months: 1 } });
  });
});
