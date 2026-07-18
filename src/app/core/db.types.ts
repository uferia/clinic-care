// Snake_case row shapes as stored in Postgres. Mappers convert to/from the
// camelCase domain models; these types never reach components or templates.

export interface PatientRow {
  id: string;
  clinic_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  blood_type: string | null;
  created_at: string;
}

export interface DoctorRow {
  id: string;
  clinic_id: string;
  name: string;
  specialty: string | null;
  rating: number | null;
  available: boolean;
}

export interface AppointmentRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  doctor_id: string;
  date: string;
  time: string;
  reason: string | null;
  status: string;
}

/** Appointment row with its embedded patient/doctor rows (PostgREST FK embed). */
export interface AppointmentRowEmbedded extends AppointmentRow {
  patient: PatientRow | null;
  doctor: DoctorRow | null;
}
