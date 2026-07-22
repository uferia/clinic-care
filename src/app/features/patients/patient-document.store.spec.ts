import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PatientDocumentsStore } from './patient-document.store';
import { SUPABASE } from '../../core/supabase.client';

const rows = [
  { id: 'd1', clinic_id: 'c1', patient_id: 'p1', object_path: 'clinics/c1/patients/p1/a.png',
    file_name: 'a.png', content_type: 'image/png', size_bytes: 10, uploaded_by: 'u1',
    created_at: '2026-07-10T09:00:00Z' },
];

function fakeClient(invokeImpl: any) {
  const selectBuilder: any = {
    eq: vi.fn(() => selectBuilder),
    order: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  };
  const insert = vi.fn(() => Promise.resolve({ error: null }));
  return {
    from: vi.fn(() => ({ select: vi.fn(() => selectBuilder), insert })),
    functions: { invoke: vi.fn(invokeImpl) },
    _insert: insert,
  };
}

function setup(client: unknown) {
  TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
  return TestBed.inject(PatientDocumentsStore);
}

describe('PatientDocumentsStore', () => {
  beforeEach(() => {
    (globalThis as any).fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200 }));
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('loads documents for the patient', async () => {
    const client = fakeClient(() => Promise.resolve({ data: {}, error: null }));
    const store = setup(client);
    store.setPatient('p1');
    await new Promise(r => setTimeout(r));
    expect(client.from).toHaveBeenCalledWith('patient_documents');
    expect(store.documents()[0].fileName).toBe('a.png');
  });

  it('upload(): signs, PUTs to GCS, inserts metadata', async () => {
    const client = fakeClient((name: string, opts: any) => {
      expect(name).toBe('gcs-doc');
      if (opts.body.action === 'sign-upload') {
        return Promise.resolve({ data: { uploadUrl: 'https://gcs/put', objectPath: 'clinics/c1/patients/p1/x.png' }, error: null });
      }
      return Promise.resolve({ data: {}, error: null });
    });
    const store = setup(client);
    store.setPatient('p1');
    const file = new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' });
    await store.upload(file);
    expect((globalThis as any).fetch).toHaveBeenCalledWith('https://gcs/put', expect.objectContaining({ method: 'PUT' }));
    expect(client._insert).toHaveBeenCalledWith(expect.objectContaining({
      object_path: 'clinics/c1/patients/p1/x.png', file_name: 'x.png',
      content_type: 'image/png', size_bytes: 3, patient_id: 'p1',
    }));
  });

  it('upload(): rejects invalid type before signing', async () => {
    const client = fakeClient(() => Promise.resolve({ data: {}, error: null }));
    const store = setup(client);
    store.setPatient('p1');
    const bad = new File(['x'], 'x.txt', { type: 'text/plain' });
    await expect(store.upload(bad)).rejects.toThrow(/type/i);
    expect(client.functions.invoke).not.toHaveBeenCalled();
  });

  it('upload(): surfaces the edge function error body, not the generic message', async () => {
    // functions.invoke() reports a generic message and hides the real reason in `context`.
    const httpError = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'unsupported type' }), { status: 400 }),
    });
    const client = fakeClient(() => Promise.resolve({ data: null, error: httpError }));
    const store = setup(client);
    store.setPatient('p1');
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    await expect(store.upload(file)).rejects.toThrow('unsupported type');
    expect((globalThis as any).fetch).not.toHaveBeenCalled();
  });

  it('upload(): no metadata insert when GCS PUT fails', async () => {
    (globalThis as any).fetch = vi.fn(() => Promise.resolve({ ok: false, status: 403 }));
    const client = fakeClient((_n: string, opts: any) =>
      Promise.resolve({ data: { uploadUrl: 'https://gcs/put', objectPath: 'p' }, error: null }));
    const store = setup(client);
    store.setPatient('p1');
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    await expect(store.upload(file)).rejects.toThrow(/upload/i);
    expect(client._insert).not.toHaveBeenCalled();
  });
});
