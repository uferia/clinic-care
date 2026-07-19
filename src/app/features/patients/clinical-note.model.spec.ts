import { describe, it, expect } from 'vitest';
import { toClinicalNote, toNoteWrite } from './clinical-note.model';
import { ClinicalNoteRow } from '../../core/db.types';

const row: ClinicalNoteRow = {
  id: 'n1', clinic_id: 'c1', patient_id: 'p1',
  author_id: 'u1', author_email: 'doc@x.com',
  visit_date: '2026-07-10', body: 'BP normal', created_at: '2026-07-10T09:00:00Z',
};

describe('clinical note mapping', () => {
  it('maps a row to a domain note', () => {
    const n = toClinicalNote(row);
    expect(n).toEqual({
      id: 'n1', clinicId: 'c1', patientId: 'p1',
      authorEmail: 'doc@x.com', visitDate: '2026-07-10',
      body: 'BP normal', createdAt: '2026-07-10T09:00:00Z',
    });
  });

  it('toNoteWrite maps to snake_case insert shape', () => {
    expect(toNoteWrite({ patientId: 'p1', visitDate: '2026-07-10', body: 'x', authorEmail: 'd@x.com' }))
      .toEqual({ patient_id: 'p1', visit_date: '2026-07-10', body: 'x', author_email: 'd@x.com' });
  });
});
