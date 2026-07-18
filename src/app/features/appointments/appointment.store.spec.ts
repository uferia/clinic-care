import { TestBed } from '@angular/core/testing';
import { AppointmentStore } from './appointment.store';
import { SUPABASE } from '../../core/supabase.client';
import { fakeSupabaseSelect } from '../../../testing/fake-supabase';

const rows = [
  {
    id: 'a1', clinic_id: 'c1', patient_id: 'p1', doctor_id: 'd1',
    date: '2026-07-20', time: '09:00', reason: 'Checkup', status: 'confirmed',
    patient: { id: 'p1', clinic_id: 'c1', first_name: 'Maria', last_name: 'Santos', email: null, phone: null, birth_date: null, blood_type: null, created_at: '2025-01-10T08:00:00Z' },
    doctor: { id: 'd1', clinic_id: 'c1', name: 'Dr. Ana Cruz', specialty: 'Cardiology', rating: 4.5, available: true },
  },
];

describe('AppointmentStore', () => {
  function setup(client: unknown) {
    TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
    return TestBed.inject(AppointmentStore);
  }

  it('embeds patient/doctor and resolves display names', async () => {
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    await new Promise(r => setTimeout(r));
    expect(client.from).toHaveBeenCalledWith('appointments');
    expect(client.recorded.select).toContain('patient:patients');
    expect(client.recorded.select).toContain('doctor:doctors');
    const view = store.appointments()[0];
    expect(view.patientName).toBe('Santos, Maria');
    expect(view.doctorName).toBe('Dr. Ana Cruz');
    expect(view.when instanceof Date).toBe(true);
  });

  it('filters by status when set', async () => {
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    store.setStatus('confirmed');
    await new Promise(r => setTimeout(r));
    expect(client.recorded.filters).toContainEqual({ method: 'eq', args: ['status', 'confirmed'] });
  });
});
