export const BLOOD_TYPES = [
  'A+',
  'A-',
  'B+',
  'B-',
  'AB+',
  'AB-',
  'O+',
  'O-',
] as const;

export type BloodType = (typeof BLOOD_TYPES)[number];

export interface Patient {
  id: string;
  clinicId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** ISO date, `YYYY-MM-DD`. */
  birthDate: string;
  bloodType: BloodType;
  allergies: string;
  conditions: string;
  medications: string;
  createdAt: string;
}

export type CreatePatientDto = Omit<Patient, 'id' | 'clinicId' | 'createdAt'>;

import { PatientRow } from '../../core/db.types';

export function toPatient(row: PatientRow): Patient {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email ?? '',
    phone: row.phone ?? '',
    birthDate: row.birth_date ?? '',
    bloodType: (row.blood_type ?? 'O+') as BloodType,
    allergies: row.allergies ?? '',
    conditions: row.conditions ?? '',
    medications: row.medications ?? '',
    createdAt: row.created_at,
  };
}

export function toPatientWrite(dto: CreatePatientDto): Record<string, unknown> {
  return {
    first_name: dto.firstName,
    last_name: dto.lastName,
    email: dto.email,
    phone: dto.phone,
    birth_date: dto.birthDate,
    blood_type: dto.bloodType,
    allergies: dto.allergies,
    conditions: dto.conditions,
    medications: dto.medications,
  };
}

export interface MedicalBackground {
  allergies: string;
  conditions: string;
  medications: string;
}

export function toMedicalWrite(m: MedicalBackground): Record<string, unknown> {
  return { allergies: m.allergies, conditions: m.conditions, medications: m.medications };
}
