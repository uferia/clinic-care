import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { TeamStore } from './team.store';
import { SUPABASE } from '../../core/supabase.client';
import { ClinicContextService } from '../../core/clinic/clinic-context.service';

const memberRows = [
  { id: 'm1', email: 'owner@x.com', role: 'clinic_admin', user_id: 'u1' },
  { id: 'm2', email: 'nurse@x.com', role: 'staff', user_id: null },
];

function makeClient(invoke = vi.fn().mockResolvedValue({ data: { inserted: [], skipped: [] }, error: null })) {
  return {
    auth: {},
    functions: { invoke },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: memberRows, error: null }) }) }),
    })),
  };
}

function setup(client: unknown) {
  TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
  TestBed.inject(ClinicContextService).access.set({
    clinicId: 'c1',
    clinicName: 'X',
    role: 'clinic_admin',
    status: 'trialing',
    trialEndsAt: new Date(Date.now() + 86400_000).toISOString(),
    activeUntil: null,
  });
  return TestBed.inject(TeamStore);
}

describe('TeamStore', () => {
  it('maps membership rows, marking unbound invites', async () => {
    const store = setup(makeClient());
    await new Promise(r => setTimeout(r));
    expect(store.members().map(m => `${m.email}:${m.bound}`)).toEqual([
      'owner@x.com:true',
      'nurse@x.com:false',
    ]);
  });

  it('invites without a clinic_id — the server pins it to the caller clinic', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { inserted: ['new@x.com'], skipped: ['taken@x.com'] },
      error: null,
    });
    const store = setup(makeClient(invoke));
    await new Promise(r => setTimeout(r));
    const result = await store.invite(['new@x.com', 'taken@x.com'], 'staff');
    expect(invoke).toHaveBeenCalledWith('add-members', {
      body: { emails: ['new@x.com', 'taken@x.com'], role: 'staff' },
    });
    expect(result).toEqual({ inserted: ['new@x.com'], skipped: ['taken@x.com'] });
  });
});
