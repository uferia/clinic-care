import { handleCors, json } from '../_shared/cors.ts';
import { requireSuperAdmin } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const gate = await requireSuperAdmin(req);
  if ('error' in gate) return json({ error: gate.error }, gate.status);

  let clinic_id: string;
  try {
    clinic_id = (await req.json()).clinic_id;
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  if (!clinic_id) return json({ error: 'clinic_id is required' }, 400);

  const { data: sub, error } = await gate.admin
    .from('subscriptions')
    .update({ status: 'expired', updated_at: new Date().toISOString(), updated_by: gate.userId })
    .eq('clinic_id', clinic_id)
    .select()
    .single();
  if (error) return json({ error: error.message }, 500);

  await gate.admin.rpc('log_audit', {
    p_clinic_id: clinic_id,
    p_actor: gate.userId,
    p_action: 'subscription.expire',
  });

  return json({ subscription: sub }, 200);
});
