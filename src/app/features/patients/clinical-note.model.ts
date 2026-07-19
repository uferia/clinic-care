import { ClinicalNoteRow } from '../../core/db.types';

export interface ClinicalNote {
  id: string;
  clinicId: string;
  patientId: string;
  authorEmail: string;
  /** ISO date, `YYYY-MM-DD`. */
  visitDate: string;
  body: string;
  createdAt: string;
}

export interface CreateNoteDto {
  patientId: string;
  visitDate: string;
  body: string;
  authorEmail: string;
}

export function toClinicalNote(row: ClinicalNoteRow): ClinicalNote {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    authorEmail: row.author_email ?? '',
    visitDate: row.visit_date,
    body: row.body,
    createdAt: row.created_at,
  };
}

export function toNoteWrite(dto: CreateNoteDto): Record<string, unknown> {
  return {
    patient_id: dto.patientId,
    visit_date: dto.visitDate,
    body: dto.body,
    author_email: dto.authorEmail,
  };
}
