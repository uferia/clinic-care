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
  name: string;
  specialty: Specialty;
  rating: number;
  available: boolean;
}

export type CreateDoctorDto = Omit<Doctor, 'id'>;
