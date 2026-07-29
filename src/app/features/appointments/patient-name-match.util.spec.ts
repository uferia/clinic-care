import { describe, it, expect } from 'vitest';
import { matchPatientByName } from './patient-name-match.util';
import { Patient } from '../patients/patient.model';

function patient(overrides: Partial<Patient>): Patient {
  return {
    id: 'p1',
    clinicId: 'c1',
    firstName: 'Maria',
    lastName: 'Santos',
    email: '',
    phone: '',
    birthDate: '',
    bloodType: 'O+',
    allergies: '',
    conditions: '',
    medications: '',
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('matchPatientByName', () => {
  it('matches on "first last" order', () => {
    const patients = [patient({ id: 'p1' })];
    expect(matchPatientByName('Maria Santos', patients)).toBe('p1');
  });

  it('matches on "last first" / "last, first" order', () => {
    const patients = [patient({ id: 'p1' })];
    expect(matchPatientByName('Santos Maria', patients)).toBe('p1');
  });

  it('is case-insensitive and whitespace-tolerant', () => {
    const patients = [patient({ id: 'p1' })];
    expect(matchPatientByName('  maria   santos  ', patients)).toBe('p1');
  });

  it('matches when the guess has extra words around the name', () => {
    const patients = [patient({ id: 'p1' })];
    expect(matchPatientByName('please book maria santos for a checkup', patients)).toBe('p1');
  });

  it('returns null when nothing matches', () => {
    const patients = [patient({ id: 'p1' })];
    expect(matchPatientByName('John Doe', patients)).toBeNull();
  });

  it('returns null when multiple patients are plausible matches', () => {
    const patients = [
      patient({ id: 'p1', firstName: 'Maria', lastName: 'Santos' }),
      patient({ id: 'p2', firstName: 'Maria', lastName: 'Cruz' }),
    ];
    expect(matchPatientByName('Maria', patients)).toBeNull();
  });

  it('returns null for an empty guess or empty patient list', () => {
    expect(matchPatientByName('', [patient({})])).toBeNull();
    expect(matchPatientByName('Maria Santos', [])).toBeNull();
  });
});
