import { handleCors, json } from '../_shared/cors.ts';
import { requireMemberManager } from '../_shared/auth.ts';

/** manage_member() raises plain messages; map the expected ones to real status codes. */
function statusFor(message: string): number {
  if (message.includes('forbidden')) return 403;
  if (message.includes('member not found')) return 404;
  if (message.includes('last admin')) return 409;
  if (message.includes('invalid action') || message.includes('invalid role')) return 400;
  return 500;
}

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const gate = await requireMemberManager(req);
  if ('error' in gate) return json({ error: gate.error }, gate.status);

  let body: { member_id?: string; action?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  const { member_id, action, role } = body;
  if (!member_id) return json({ error: 'member_id is required' }, 400);
  if (action !== 'set_role' && action !== 'remove') return json({ error: 'invalid action' }, 400);

  // The clinic match and the last-admin rule are re-checked inside the transaction.
  const { data: member, error } = await gate.admin.rpc('manage_member', {
    p_actor_user_id: gate.userId,
    p_member_id: member_id,
    p_action: action,
    p_role: role ?? null,
  });
  if (error) return json({ error: error.message }, statusFor(error.message));

  return json({ member }, 200);
});
