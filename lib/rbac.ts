// Reusable role guard — the RBAC primitive for role-scoped surfaces.
// Authoritative role source is public.user_profiles.role (read via the
// service-role client, same pattern as app/api/admin/*). The JWT
// user_metadata.role is used ONLY for cheap routing hints in proxy.ts.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient, type UserRole } from '@/lib/supabase/admin';

export interface SessionRole {
  userId: string;
  email: string | null;
  role: UserRole;
}

/** The signed-in user's authoritative role, or null when signed out / unconfigured. */
export async function getSessionRole(): Promise<SessionRole | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  if (!admin) return null;

  const { data: profile } = await admin
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!profile) return null;

  return { userId: user.id, email: user.email ?? null, role: profile.role as UserRole };
}

/** Session if the user holds one of the allowed roles, else null. */
export async function hasRole(allowed: UserRole[]): Promise<SessionRole | null> {
  const session = await getSessionRole();
  return session && allowed.includes(session.role) ? session : null;
}
