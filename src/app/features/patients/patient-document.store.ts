import { computed, inject, resource, Service, signal } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { PatientDocument, toPatientDocument, validateFile } from './patient-document.model';

interface SignUploadResponse {
  uploadUrl: string;
  objectPath: string;
}

/**
 * functions.invoke() reports every failure as "Edge Function returned a non-2xx
 * status code" and hides the function's own `{ error }` body in `context`.
 * Unwrap it so the UI can show the real reason.
 */
async function edgeError(error: unknown): Promise<Error> {
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      const message = (body as { error?: string }).error;
      if (message) return new Error(message);
    } catch {
      // Body was not JSON — fall back to the original error.
    }
  }
  return error instanceof Error ? error : new Error('Request failed.');
}

@Service()
export class PatientDocumentsStore {
  private supabase = inject(SUPABASE);
  private _patientId = signal<string | null>(null);

  setPatient(id: string) {
    this._patientId.set(id);
  }

  private docsResource = resource({
    params: () => ({ patientId: this._patientId() }),
    loader: async ({ params }) => {
      if (!params.patientId) return [] as PatientDocument[];
      const { data, error } = await this.supabase
        .from('patient_documents')
        .select('*')
        .eq('patient_id', params.patientId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(toPatientDocument);
    },
  });

  documents = computed<PatientDocument[]>(() => this.docsResource.value() ?? []);
  readonly isLoading = computed(() => this.docsResource.isLoading());
  readonly error = computed(() => this.docsResource.error());

  async upload(file: File): Promise<void> {
    const patientId = this._patientId();
    if (!patientId) throw new Error('No patient selected.');

    const invalid = validateFile(file);
    if (invalid) throw new Error(invalid);

    // 1. Ask the edge function for a signed PUT URL.
    const { data, error } = await this.supabase.functions.invoke('gcs-doc', {
      body: { action: 'sign-upload', patientId, fileName: file.name, contentType: file.type, sizeBytes: file.size },
    });
    if (error) throw await edgeError(error);
    const { uploadUrl, objectPath } = data as SignUploadResponse;

    // 2. Upload bytes directly to GCS. The signed URL pins the content type.
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!put.ok) throw new Error(`Upload failed (${put.status}).`);

    // 3. Only after a successful PUT, record metadata (clinic_id forced by trigger).
    const { error: insErr } = await this.supabase.from('patient_documents').insert({
      patient_id: patientId,
      object_path: objectPath,
      file_name: file.name,
      content_type: file.type,
      size_bytes: file.size,
    });
    if (insErr) throw insErr;

    this.docsResource.reload();
  }

  async downloadUrl(doc: PatientDocument): Promise<string> {
    const { data, error } = await this.supabase.functions.invoke('gcs-doc', {
      body: { action: 'sign-download', documentId: doc.id },
    });
    if (error) throw await edgeError(error);
    return (data as { downloadUrl: string }).downloadUrl;
  }

  async remove(doc: PatientDocument): Promise<void> {
    const { error } = await this.supabase.functions.invoke('gcs-doc', {
      body: { action: 'delete', documentId: doc.id },
    });
    if (error) throw await edgeError(error);
    this.docsResource.reload();
  }
}
