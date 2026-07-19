import { handleCors, json } from '../_shared/cors.ts';
import { requireClinicMember } from '../_shared/auth.ts';
import { signedUrl, deleteObject } from '../_shared/gcs.ts';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const MAX_BYTES = 10 * 1024 * 1024;
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const gate = await requireClinicMember(req);
  if ('error' in gate) return json({ error: gate.error }, gate.status);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  const action = body.action;

  if (action === 'sign-upload') {
    const patientId = String(body.patientId ?? '');
    const contentType = String(body.contentType ?? '');
    const sizeBytes = Number(body.sizeBytes ?? 0);
    if (!patientId) return json({ error: 'patientId required' }, 400);
    if (!ALLOWED.has(contentType)) return json({ error: 'unsupported type' }, 400);
    if (!(sizeBytes > 0) || sizeBytes > MAX_BYTES) return json({ error: 'invalid size' }, 400);

    // Patient must belong to the caller's clinic.
    const { data: patient } = await gate.admin
      .from('patients')
      .select('id')
      .eq('id', patientId)
      .eq('clinic_id', gate.clinicId)
      .maybeSingle();
    if (!patient) return json({ error: 'patient not found' }, 404);

    const objectPath = `clinics/${gate.clinicId}/patients/${patientId}/${crypto.randomUUID()}.${EXT[contentType]}`;
    const uploadUrl = await signedUrl('PUT', objectPath, 300, contentType);
    return json({ uploadUrl, objectPath }, 200);
  }

  if (action === 'sign-download') {
    const documentId = String(body.documentId ?? '');
    if (!documentId) return json({ error: 'documentId required' }, 400);
    const { data: doc } = await gate.admin
      .from('patient_documents')
      .select('object_path')
      .eq('id', documentId)
      .eq('clinic_id', gate.clinicId)
      .maybeSingle();
    if (!doc) return json({ error: 'not found' }, 404);
    const downloadUrl = await signedUrl('GET', doc.object_path, 300);
    return json({ downloadUrl }, 200);
  }

  if (action === 'delete') {
    const documentId = String(body.documentId ?? '');
    if (!documentId) return json({ error: 'documentId required' }, 400);
    const { data: doc } = await gate.admin
      .from('patient_documents')
      .select('object_path')
      .eq('id', documentId)
      .eq('clinic_id', gate.clinicId)
      .maybeSingle();
    if (!doc) return json({ error: 'not found' }, 404);

    await deleteObject(doc.object_path);
    const { error } = await gate.admin.from('patient_documents').delete().eq('id', documentId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true }, 200);
  }

  return json({ error: 'unknown action' }, 400);
});
