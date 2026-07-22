import { handleCors, json } from '../_shared/cors.ts';
import { requireAuthUser } from '../_shared/auth.ts';

/** Postgres raises plain messages; map the expected ones to real status codes. */
function statusFor(message: string): number {
  if (message.includes('already a member')) return 409;
  if (message.includes('name required') || message.includes('email required')) return 400;
  return 500;
}

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  // Open to any signed-in account — this is the self-service path, not a super-admin one.
  const gate = await requireAuthUser(req);
  if ('error' in gate) return json({ error: gate.error }, gate.status);

  let name: string;
  try {
    name = (await req.json()).name;
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  if (!name?.trim()) return json({ error: 'name is required' }, 400);

  // One transaction: clinic + trialing subscription + clinic_admin membership, or nothing.
  const { data: clinic, error } = await gate.admin.rpc('register_clinic', {
    p_user_id: gate.userId,
    p_email: gate.email,
    p_name: name.trim(),
  });
  if (error) return json({ error: error.message }, statusFor(error.message));

  return json({ clinic }, 200);
});
