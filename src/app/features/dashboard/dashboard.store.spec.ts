import { TestBed } from '@angular/core/testing';
import { DashboardStore } from './dashboard.store';
import { SUPABASE } from '../../core/supabase.client';
import { vi } from 'vitest';

function client() {
  const patients = [{ id: 'p1', clinic_id: 'c1', first_name: 'A', last_name: 'B', email: null, phone: null, birth_date: null, blood_type: null, created_at: '2025-01-01T00:00:00Z' }];
  const doctors = [{ id: 'd1', clinic_id: 'c1', name: 'Dr X', specialty: 'Cardiology', rating: 4, available: true }];
  const appts = [{ id: 'a1', clinic_id: 'c1', patient_id: 'p1', doctor_id: 'd1', date: '2999-01-01', time: '09:00', reason: '', status: 'confirmed', patient: patients[0], doctor: doctors[0] }];
  const table = (rows: unknown[]) => ({ select: vi.fn(() => ({ then: (r: (v: unknown) => void) => r({ data: rows, error: null }) })) });
  return {
    from: vi.fn((t: string) => t === 'patients' ? table(patients) : t === 'doctors' ? table(doctors) : table(appts)),
  };
}

describe('DashboardStore', () => {
  it('aggregates counts from supabase rows', async () => {
    TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client() }] });
    const store = TestBed.inject(DashboardStore);
    await new Promise(r => setTimeout(r));
    expect(store.patientCount()).toBe(1);
    expect(store.doctorCount()).toBe(1);
    expect(store.doctorsAvailable()).toBe(1);
    expect(store.upcomingCount()).toBe(1);
    expect(store.nextUp()?.doctorName).toBe('Dr X');
  });
});
