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
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** ISO date, `YYYY-MM-DD`. */
  birthDate: string;
  bloodType: BloodType;
  createdAt: string;
}

export type CreatePatientDto = Omit<Patient, 'id' | 'createdAt'>;
