import { handleCors, json } from '../_shared/cors.ts';
import { requireMemberManager } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const gate = await requireMemberManager(req);
  if ('error' in gate) return json({ error: gate.error }, gate.status);

  let body: { clinic_id?: string; emails?: string[]; role?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  const { emails, role = 'staff' } = body;

  // A super-admin targets any clinic; a clinic_admin is pinned to their own, whatever the body says.
  const clinic_id = gate.isSuperAdmin ? body.clinic_id : gate.clinicId;
  if (!clinic_id) return json({ error: 'clinic_id is required' }, 400);
  if (!Array.isArray(emails) || emails.length === 0) return json({ error: 'emails required' }, 400);
  if (role !== 'clinic_admin' && role !== 'staff') return json({ error: 'invalid role' }, 400);

  // Normalize + de-dup within the request.
  const clean = [...new Set(
    emails.filter((e): e is string => typeof e === 'string').map(e => e.trim().toLowerCase()).filter(Boolean),
  )];
  if (clean.length === 0) return json({ error: 'no valid emails' }, 400);

  // Which already exist anywhere (email is globally unique)?
  const { data: existing, error: lookupErr } = await gate.admin
    .from('memberships')
    .select('email')
    .in('email', clean);
  if (lookupErr) return json({ error: lookupErr.message }, 500);
  const taken = new Set((existing ?? []).map((r: { email: string }) => r.email));

  const toInsert = clean.filter(e => !taken.has(e));
  const skipped = clean.filter(e => taken.has(e));

  if (toInsert.length) {
    const rows = toInsert.map(email => ({ clinic_id, email, role }));
    const { error } = await gate.admin.from('memberships').insert(rows);
    if (error) return json({ error: error.message }, 500);

    await gate.admin.rpc('log_audit', {
      p_clinic_id: clinic_id,
      p_actor: gate.userId,
      p_action: 'member.invite',
      p_target: toInsert.join(', '),
      p_details: { role, count: toInsert.length },
    });
  }

  return json({ inserted: toInsert, skipped }, 200);
});
