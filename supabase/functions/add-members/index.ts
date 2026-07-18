import { handleCors, json } from '../_shared/cors.ts';
import { requireSuperAdmin } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const gate = await requireSuperAdmin(req);
  if ('error' in gate) return json({ error: gate.error }, gate.status);

  let body: { clinic_id?: string; emails?: string[]; role?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  const { clinic_id, emails, role = 'staff' } = body;
  if (!clinic_id) return json({ error: 'clinic_id is required' }, 400);
  if (!Array.isArray(emails) || emails.length === 0) return json({ error: 'emails required' }, 400);
  if (role !== 'clinic_admin' && role !== 'staff') return json({ error: 'invalid role' }, 400);

  // Normalize + de-dup within the request.
  const clean = [...new Set(emails.map(e => e.trim().toLowerCase()).filter(Boolean))];

  // Which already exist anywhere (email is globally unique)?
  const { data: existing } = await gate.admin
    .from('memberships')
    .select('email')
    .in('email', clean);
  const taken = new Set((existing ?? []).map((r: { email: string }) => r.email));

  const toInsert = clean.filter(e => !taken.has(e));
  const skipped = clean.filter(e => taken.has(e));

  if (toInsert.length) {
    const rows = toInsert.map(email => ({ clinic_id, email, role }));
    const { error } = await gate.admin.from('memberships').insert(rows);
    if (error) return json({ error: error.message }, 500);
  }

  return json({ inserted: toInsert, skipped }, 200);
});
