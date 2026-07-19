import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ClinicalNotesStore } from './clinical-note.store';
import { SUPABASE } from '../../core/supabase.client';

const rows = [
  { id: 'n1', clinic_id: 'c1', patient_id: 'p1', author_id: 'u1', author_email: 'd@x.com',
    visit_date: '2026-07-10', body: 'note', created_at: '2026-07-10T09:00:00Z' },
];

function fakeClient() {
  const selectBuilder: any = {
    eq: vi.fn(() => selectBuilder),
    order: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  };
  const insert = vi.fn(() => Promise.resolve({ error: null }));
  const del: any = { eq: vi.fn(() => Promise.resolve({ error: null })) };
  const client = {
    from: vi.fn(() => ({
      select: vi.fn(() => selectBuilder),
      insert,
      delete: vi.fn(() => del),
    })),
    _insert: insert,
    _delEq: del.eq,
  };
  return client;
}

function setup(client: unknown) {
  TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
  return TestBed.inject(ClinicalNotesStore);
}

describe('ClinicalNotesStore', () => {
  it('loads notes for the set patient, newest first', async () => {
    const client = fakeClient();
    const store = setup(client);
    store.setPatient('p1');
    await new Promise(r => setTimeout(r));
    expect(client.from).toHaveBeenCalledWith('patient_clinical_notes');
    expect(store.notes()[0].body).toBe('note');
  });

  it('add() inserts snake_case row', async () => {
    const client = fakeClient();
    const store = setup(client);
    store.setPatient('p1');
    await store.add({ patientId: 'p1', visitDate: '2026-07-10', body: 'x', authorEmail: 'd@x.com' });
    expect(client._insert).toHaveBeenCalledWith({
      patient_id: 'p1', visit_date: '2026-07-10', body: 'x', author_email: 'd@x.com',
    });
  });

  it('remove() deletes by id', async () => {
    const client = fakeClient();
    const store = setup(client);
    store.setPatient('p1');
    await store.remove('n1');
    expect(client._delEq).toHaveBeenCalledWith('id', 'n1');
  });
});
