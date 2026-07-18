import { TestBed } from '@angular/core/testing';
import { DoctorStore } from './doctor.store';
import { SUPABASE } from '../../core/supabase.client';
import { fakeSupabaseSelect } from '../../../testing/fake-supabase';

const rows = [
  { id: 'd1', clinic_id: 'c1', name: 'Dr. Ana Cruz', specialty: 'Cardiology', rating: 4.5, available: true },
];

describe('DoctorStore', () => {
  function setup(client: unknown) {
    TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
    return TestBed.inject(DoctorStore);
  }

  it('queries doctors with pagination and maps rows', async () => {
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    await new Promise(r => setTimeout(r));
    expect(client.from).toHaveBeenCalledWith('doctors');
    expect(client.recorded.filters.find(f => f.method === 'range')?.args).toEqual([0, 5]);
    expect(store.visibleDoctors()[0].name).toBe('Dr. Ana Cruz');
  });

  it('applies specialty and availableOnly filters', async () => {
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    store.setSpecialty('Cardiology');
    store.setAvailableOnly(true);
    await new Promise(r => setTimeout(r));
    const eqs = client.recorded.filters.filter(f => f.method === 'eq');
    expect(eqs).toContainEqual({ method: 'eq', args: ['specialty', 'Cardiology'] });
    expect(eqs).toContainEqual({ method: 'eq', args: ['available', true] });
  });
});
