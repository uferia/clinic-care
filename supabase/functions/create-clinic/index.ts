import { handleCors, json } from '../_shared/cors.ts';
import { requireSuperAdmin } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const gate = await requireSuperAdmin(req);
  if ('error' in gate) return json({ error: gate.error }, gate.status);

  let name: string;
  try {
    name = (await req.json()).name;
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  if (!name?.trim()) return json({ error: 'name is required' }, 400);

  const { data: clinic, error } = await gate.admin
    .from('clinics')
    .insert({ name: name.trim() })
    .select()
    .single();
  if (error) return json({ error: error.message }, 500);

  const trialEnds = new Date(Date.now() + 14 * 86400_000).toISOString();
  const { error: subErr } = await gate.admin
    .from('subscriptions')
    .insert({ clinic_id: clinic.id, status: 'trialing', trial_ends_at: trialEnds });
  if (subErr) return json({ error: subErr.message }, 500);

  return json({ clinic }, 200);
});
