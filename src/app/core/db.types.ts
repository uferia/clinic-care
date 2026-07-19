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
  allergies: string | null;
  conditions: string | null;
  medications: string | null;
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

export interface ClinicalNoteRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  author_id: string | null;
  author_email: string | null;
  visit_date: string;
  body: string;
  created_at: string;
}

export interface PatientDocumentRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  object_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
}
