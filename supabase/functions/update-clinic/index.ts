import { handleCors, json } from '../_shared/cors.ts';
import { requireMemberManager } from '../_shared/auth.ts';

function statusFor(message: string): number {
  if (message.includes('forbidden')) return 403;
  if (message.includes('clinic not found')) return 404;
  if (message.includes('name required')) return 400;
  return 500;
}

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  // Same gate as add-members: a clinic_admin for their own clinic, or a super-admin for any.
  const gate = await requireMemberManager(req);
  if ('error' in gate) return json({ error: gate.error }, gate.status);

  let body: {
    clinic_id?: string;
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    tax_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }

  // A clinic_admin edits their own clinic whatever the body says; only a super-admin picks.
  const clinicId = gate.isSuperAdmin ? body.clinic_id : gate.clinicId;
  if (!clinicId) return json({ error: 'clinic_id is required' }, 400);
  if (!body.name?.trim()) return json({ error: 'name is required' }, 400);

  const { data: clinic, error } = await gate.admin.rpc('update_clinic_profile', {
    p_actor_user_id: gate.userId,
    p_clinic_id: clinicId,
    p_name: body.name,
    p_address: body.address ?? null,
    p_phone: body.phone ?? null,
    p_email: body.email ?? null,
    p_tax_id: body.tax_id ?? null,
  });
  if (error) return json({ error: error.message }, statusFor(error.message));

  return json({ clinic }, 200);
});
