import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface Gate {
  admin: SupabaseClient;
  userId: string;
}

/**
 * Verify the caller's JWT and confirm they are a super-admin.
 * Returns a service-role client on success, or an error tuple.
 */
export async function requireSuperAdmin(
  req: Request,
): Promise<Gate | { error: string; status: number }> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return { error: 'unauthorized', status: 401 };

  // Resolve the caller from their JWT.
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error } = await caller.auth.getUser();
  if (error || !user) return { error: 'unauthorized', status: 401 };

  // Service-role client for the privileged checks + writes.
  const admin = createClient(url, service);
  const { data: sa } = await admin.from('super_admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!sa) return { error: 'forbidden', status: 403 };

  return { admin, userId: user.id };
}
