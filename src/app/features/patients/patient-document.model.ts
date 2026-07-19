import { PatientDocumentRow } from '../../core/db.types';

export const ALLOWED_DOC_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

export interface PatientDocument {
  id: string;
  clinicId: string;
  patientId: string;
  objectPath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  isImage: boolean;
}

export function toPatientDocument(row: PatientDocumentRow): PatientDocument {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    objectPath: row.object_path,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    isImage: row.content_type.startsWith('image/'),
  };
}

/** Returns a human error message, or null when the file is acceptable. */
export function validateFile(file: { type: string; size: number }): string | null {
  if (!ALLOWED_DOC_TYPES.includes(file.type as (typeof ALLOWED_DOC_TYPES)[number])) {
    return 'Unsupported file type. Use JPEG, PNG, or PDF.';
  }
  if (file.size > MAX_DOC_BYTES) {
    return 'File too large. Max 10MB.';
  }
  return null;
}
