import { toPatient, toPatientWrite } from './patient.model';
import { PatientRow } from '../../core/db.types';

const row: PatientRow = {
  id: 'p1', clinic_id: 'c1', first_name: 'Maria', last_name: 'Santos',
  email: 'maria@mail.com', phone: '+639171234567', birth_date: '1990-05-14',
  blood_type: 'O+', created_at: '2025-01-10T08:00:00Z',
};

describe('patient mapper', () => {
  it('maps a row to a camelCase Patient', () => {
    expect(toPatient(row)).toEqual({
      id: 'p1', clinicId: 'c1', firstName: 'Maria', lastName: 'Santos',
      email: 'maria@mail.com', phone: '+639171234567', birthDate: '1990-05-14',
      bloodType: 'O+', createdAt: '2025-01-10T08:00:00Z',
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
    });
    expect(payload).toEqual({
      first_name: 'Jose', last_name: 'Reyes', email: 'j@x.com',
      phone: '+639181234567', birth_date: '1985-11-02', blood_type: 'A-',
    });
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('clinic_id');
    expect(payload).not.toHaveProperty('created_at');
  });
});
