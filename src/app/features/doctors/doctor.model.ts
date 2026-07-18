export const SPECIALTIES = [
  'Cardiology',
  'Pediatrics',
  'Dermatology',
  'Orthopedics',
  'Neurology',
  'General Medicine',
  'Obstetrics',
] as const;

export type Specialty = (typeof SPECIALTIES)[number];

export interface Doctor {
  id: string;
  clinicId: string;
  name: string;
  specialty: Specialty;
  rating: number;
  available: boolean;
}

export type CreateDoctorDto = Omit<Doctor, 'id' | 'clinicId'>;

import { DoctorRow } from '../../core/db.types';

export function toDoctor(row: DoctorRow): Doctor {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    name: row.name,
    specialty: (row.specialty ?? 'General Medicine') as Specialty,
    rating: row.rating ?? 0,
    available: row.available,
  };
}

export function toDoctorWrite(dto: CreateDoctorDto): Record<string, unknown> {
  return {
    name: dto.name,
    specialty: dto.specialty,
    rating: dto.rating,
    available: dto.available,
  };
}
