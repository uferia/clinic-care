import { handleCors, json } from '../_shared/cors.ts';
import { requireSuperAdmin } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const gate = await requireSuperAdmin(req);
  if ('error' in gate) return json({ error: gate.error }, gate.status);

  let body: { clinic_id?: string; months?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  const { clinic_id, months = 1 } = body;
  if (!clinic_id) return json({ error: 'clinic_id is required' }, 400);
  if (!Number.isFinite(months) || months < 1) return json({ error: 'invalid months' }, 400);

  const { data: current } = await gate.admin
    .from('subscriptions')
    .select('active_until')
    .eq('clinic_id', clinic_id)
    .maybeSingle();

  const now = Date.now();
  const base = current?.active_until ? Math.max(now, new Date(current.active_until).getTime()) : now;
  const activeUntil = new Date(base + months * 30 * 86400_000).toISOString();

  const { data: sub, error } = await gate.admin
    .from('subscriptions')
    .update({ status: 'active', active_until: activeUntil, updated_at: new Date().toISOString(), updated_by: gate.userId })
    .eq('clinic_id', clinic_id)
    .select()
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ subscription: sub }, 200);
});
