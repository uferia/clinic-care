import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PatientStore } from './patient.store';
import { SUPABASE } from '../../core/supabase.client';
import { fakeSupabaseSelect } from '../../../testing/fake-supabase';

const rows = [
  { id: 'p1', clinic_id: 'c1', first_name: 'Maria', last_name: 'Santos', email: 'm@x.com', phone: '+639171234567', birth_date: '1990-05-14', blood_type: 'O+', created_at: '2025-01-10T08:00:00Z' },
];

describe('PatientStore', () => {
  function setup(client: unknown) {
    TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
    return TestBed.inject(PatientStore);
  }

  it('queries the patients table with pagination and maps rows', async () => {
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    // resource loaders are async; allow the microtask queue to flush
    await new Promise(r => setTimeout(r));
    expect(client.from).toHaveBeenCalledWith('patients');
    // range(0,4) for page 1, pageSize 5
    expect(client.recorded.filters.find(f => f.method === 'range')?.args).toEqual([0, 4]);
    expect(store.total()).toBe(1);
    expect(store.visiblePatients()[0].firstName).toBe('Maria');
  });

  it('adds an ilike OR filter when searching', async () => {
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    store.setSearch('mar');
    // debounce is 300ms
    await new Promise(r => setTimeout(r, 350));
    const or = client.recorded.filters.find(f => f.method === 'or');
    expect(String(or?.args[0])).toContain('first_name.ilike.%mar%');
    expect(String(or?.args[0])).toContain('last_name.ilike.%mar%');
  });

  it('getById selects a single patient by id', async () => {
    const single = { data: rows[0], error: null };
    const client: any = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(single) }) }) }),
    };
    const store = setup(client);
    const p = await store.getById('p1');
    expect(p?.firstName).toBe('Maria');
  });

  it('saveMedical updates the three medical columns', async () => {
    const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    const client: any = { from: vi.fn(() => ({ update })) };
    const store = setup(client);
    await store.saveMedical('p1', { allergies: 'a', conditions: 'c', medications: 'm' });
    expect(update).toHaveBeenCalledWith({ allergies: 'a', conditions: 'c', medications: 'm' });
  });
});
