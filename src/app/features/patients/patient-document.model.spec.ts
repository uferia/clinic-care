import { describe, it, expect } from 'vitest';
import { toPatientDocument, validateFile, MAX_DOC_BYTES } from './patient-document.model';
import { PatientDocumentRow } from '../../core/db.types';

const row: PatientDocumentRow = {
  id: 'd1', clinic_id: 'c1', patient_id: 'p1',
  object_path: 'clinics/c1/patients/p1/abc.png', file_name: 'scan.png',
  content_type: 'image/png', size_bytes: 1234, uploaded_by: 'u1',
  created_at: '2026-07-10T09:00:00Z',
};

describe('patient document mapping', () => {
  it('maps a row and flags images', () => {
    const d = toPatientDocument(row);
    expect(d.fileName).toBe('scan.png');
    expect(d.isImage).toBe(true);
  });

  it('flags pdf as non-image', () => {
    expect(toPatientDocument({ ...row, content_type: 'application/pdf' }).isImage).toBe(false);
  });

  it('validateFile rejects wrong type', () => {
    expect(validateFile({ type: 'text/plain', size: 10 })).toMatch(/type/i);
  });

  it('validateFile rejects oversize', () => {
    expect(validateFile({ type: 'image/png', size: MAX_DOC_BYTES + 1 })).toMatch(/10 ?MB/i);
  });

  it('validateFile accepts a valid file', () => {
    expect(validateFile({ type: 'application/pdf', size: 100 })).toBeNull();
  });
});
