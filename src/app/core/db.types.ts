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

export interface ServiceRow {
  id: string;
  clinic_id: string;
  name: string;
  description: string | null;
  price: number | string;
  active: boolean;
  created_at: string;
}

export interface InvoiceRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  appointment_id: string | null;
  number: string | null;
  issue_date: string;
  discount_type: 'amount' | 'percent' | null;
  discount_value: number | string;
  tax_rate: number | string;
  notes: string | null;
  voided: boolean;
  created_by: string | null;
  created_at: string;
}

export interface InvoiceItemRow {
  id: string;
  clinic_id: string;
  invoice_id: string;
  service_id: string | null;
  description: string;
  unit_price: number | string;
  quantity: number | string;
}

export interface PaymentRow {
  id: string;
  clinic_id: string;
  invoice_id: string;
  kind: 'payment' | 'refund';
  amount: number | string;
  paid_at: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface InvoiceBalanceRow extends InvoiceRow {
  subtotal: number | string;
  discount: number | string;
  tax: number | string;
  total: number | string;
  paid: number | string;
  balance: number | string;
  status: 'unpaid' | 'partial' | 'paid' | 'void';
}

export interface BillingSettingsRow {
  clinic_id: string;
  currency: string;
  tax_rate: number | string;
  tax_label: string;
  updated_at: string;
  updated_by: string | null;
}
