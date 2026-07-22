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

export interface UserGate {
  admin: SupabaseClient;
  userId: string;
  email: string;
}

/**
 * Verify the caller's JWT only — no membership or role required. For endpoints open to any
 * signed-in account (self-service clinic registration).
 */
export async function requireAuthUser(
  req: Request,
): Promise<UserGate | { error: string; status: number }> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return { error: 'unauthorized', status: 401 };

  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error } = await caller.auth.getUser();
  if (error || !user) return { error: 'unauthorized', status: 401 };
  if (!user.email) return { error: 'email required', status: 400 };

  return { admin: createClient(url, service), userId: user.id, email: user.email };
}

export interface MemberManagerGate {
  admin: SupabaseClient;
  userId: string;
  /** Super-admins manage any clinic, so this is null and the caller supplies the target. */
  clinicId: string | null;
  isSuperAdmin: boolean;
}

/**
 * Verify the caller may seed memberships: either a platform super-admin (any clinic) or a
 * clinic_admin (their own clinic only — `clinicId` is authoritative, never trust the body).
 */
export async function requireMemberManager(
  req: Request,
): Promise<MemberManagerGate | { error: string; status: number }> {
  const gate = await requireAuthUser(req);
  if ('error' in gate) return gate;

  const { data: sa } = await gate.admin
    .from('super_admins')
    .select('user_id')
    .eq('user_id', gate.userId)
    .maybeSingle();
  if (sa) return { admin: gate.admin, userId: gate.userId, clinicId: null, isSuperAdmin: true };

  const { data: membership } = await gate.admin
    .from('memberships')
    .select('clinic_id, role')
    .eq('user_id', gate.userId)
    .maybeSingle();
  if (!membership || membership.role !== 'clinic_admin') return { error: 'forbidden', status: 403 };

  return {
    admin: gate.admin,
    userId: gate.userId,
    clinicId: membership.clinic_id as string,
    isSuperAdmin: false,
  };
}

export interface ClinicGate {
  admin: SupabaseClient;
  userId: string;
  email: string;
  clinicId: string;
}

/**
 * Verify the caller's JWT and confirm they are a member of a clinic with a
 * live subscription. Returns a service-role client + their clinic context.
 */
export async function requireClinicMember(
  req: Request,
): Promise<ClinicGate | { error: string; status: number }> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return { error: 'unauthorized', status: 401 };

  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error } = await caller.auth.getUser();
  if (error || !user) return { error: 'unauthorized', status: 401 };

  const admin = createClient(url, service);

  const { data: membership } = await admin
    .from('memberships')
    .select('clinic_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) return { error: 'forbidden', status: 403 };
  const clinicId = membership.clinic_id as string;

  // Subscription must be live (mirrors current_clinic_active()).
  const { data: sub } = await admin
    .from('subscriptions')
    .select('status, trial_ends_at, active_until')
    .eq('clinic_id', clinicId)
    .maybeSingle();
  const now = Date.now();
  const live = !!sub && (
    (sub.status === 'trialing' && sub.trial_ends_at && new Date(sub.trial_ends_at).getTime() > now) ||
    (sub.status === 'active' && sub.active_until && new Date(sub.active_until).getTime() > now)
  );
  if (!live) return { error: 'inactive', status: 403 };

  return { admin, userId: user.id, email: user.email ?? '', clinicId };
}
