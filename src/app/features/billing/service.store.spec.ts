import { TestBed } from '@angular/core/testing';
import { ServiceStore } from './service.store';
import { SUPABASE } from '../../core/supabase.client';
import { fakeSupabaseSelect } from '../../../testing/fake-supabase';

const rows = [
  { id: 's1', clinic_id: 'c1', name: 'Consultation', description: '', price: '500.00', active: true, created_at: '2026-07-19T00:00:00Z' },
];

describe('ServiceStore', () => {
  function setup(client: unknown) {
    TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
    return TestBed.inject(ServiceStore);
  }

  it('queries services ordered by name and maps rows', async () => {
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    await new Promise(r => setTimeout(r));
    expect(client.from).toHaveBeenCalledWith('services');
    expect(store.services()[0].price).toBe(500);
  });

  it('applies active-only filter', async () => {
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    store.setActiveOnly(true);
    await new Promise(r => setTimeout(r));
    const eqs = client.recorded.filters.filter(f => f.method === 'eq');
    expect(eqs).toContainEqual({ method: 'eq', args: ['active', true] });
  });
});
