import { describe, it, expect } from 'vitest';
import { toPatient, toPatientWrite, toMedicalWrite } from './patient.model';
import { PatientRow } from '../../core/db.types';

const row: PatientRow = {
  id: 'p1', clinic_id: 'c1', first_name: 'Maria', last_name: 'Santos',
  email: 'maria@mail.com', phone: '+639171234567', birth_date: '1990-05-14',
  blood_type: 'O+', allergies: null, conditions: null, medications: null,
  created_at: '2025-01-10T08:00:00Z',
};

describe('patient mapper', () => {
  it('maps a row to a camelCase Patient', () => {
    expect(toPatient(row)).toEqual({
      id: 'p1', clinicId: 'c1', firstName: 'Maria', lastName: 'Santos',
      email: 'maria@mail.com', phone: '+639171234567', birthDate: '1990-05-14',
      bloodType: 'O+', allergies: '', conditions: '', medications: '',
      createdAt: '2025-01-10T08:00:00Z',
    });
  });

  it('coerces null optional columns to empty strings', () => {
    const p = toPatient({ ...row, email: null, phone: null, birth_date: null, blood_type: null });
    expect(p.email).toBe('');
    expect(p.phone).toBe('');
    expect(p.birthDate).toBe('');
    expect(p.bloodType).toBe('O+');
  });

  it('builds a snake_case write payload with no id/clinic_id/created_at', () => {
    const payload = toPatientWrite({
      firstName: 'Jose', lastName: 'Reyes', email: 'j@x.com',
      phone: '+639181234567', birthDate: '1985-11-02', bloodType: 'A-',
      allergies: '', conditions: '', medications: '',
    });
    expect(payload).toEqual({
      first_name: 'Jose', last_name: 'Reyes', email: 'j@x.com',
      phone: '+639181234567', birth_date: '1985-11-02', blood_type: 'A-',
      allergies: '', conditions: '', medications: '',
    });
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('clinic_id');
    expect(payload).not.toHaveProperty('created_at');
  });
});

const medicalRow: PatientRow = {
  id: 'p1', clinic_id: 'c1', first_name: 'A', last_name: 'B',
  email: null, phone: null, birth_date: null, blood_type: null,
  allergies: 'penicillin', conditions: 'asthma', medications: null,
  created_at: '2026-01-01T00:00:00Z',
};

describe('patient medical mapping', () => {
  it('maps medical background from row, null -> empty string', () => {
    const p = toPatient(medicalRow);
    expect(p.allergies).toBe('penicillin');
    expect(p.conditions).toBe('asthma');
    expect(p.medications).toBe('');
  });

  it('toPatientWrite includes medical fields', () => {
    const w = toPatientWrite({
      firstName: 'A', lastName: 'B', email: '', phone: '', birthDate: '', bloodType: 'O+',
      allergies: 'x', conditions: 'y', medications: 'z',
    });
    expect(w).toMatchObject({ allergies: 'x', conditions: 'y', medications: 'z' });
  });

  it('toMedicalWrite maps only medical fields', () => {
    expect(toMedicalWrite({ allergies: 'a', conditions: 'c', medications: 'm' }))
      .toEqual({ allergies: 'a', conditions: 'c', medications: 'm' });
  });
});
