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
  };
}
